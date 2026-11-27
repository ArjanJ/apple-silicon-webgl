// Zero-sudo Native macOS Apple Silicon Telemetry Helper
// Reads Mach host_processor_info, host_statistics64, IOKit IOAccelerator (real GPU % & VRAM),
// IOHIDEventSystem PMU die temperatures (deg C), NSProcessInfo thermalState, and getifaddrs net I/O.
//
// Compile:
//   clang -O2 -fobjc-arc -framework Foundation -framework IOKit -framework CoreFoundation \
//         native/mac_telemetry.m -o native/mac_telemetry

#import <Foundation/Foundation.h>
#import <IOKit/IOKitLib.h>
#import <CoreFoundation/CoreFoundation.h>
#include <mach/mach.h>
#include <mach/processor_info.h>
#include <mach/mach_host.h>
#include <sys/sysctl.h>
#include <ifaddrs.h>
#include <net/if.h>
#include <dlfcn.h>
#include <unistd.h>
#include <stdio.h>
#include <string.h>

// Dynamic IOHIDEventSystem bindings for Apple Silicon PMU thermal sensors (zero-sudo)
typedef struct __IOHIDEventSystemClient *IOHIDEventSystemClientRef;
typedef struct __IOHIDServiceClient *IOHIDServiceClientRef;
typedef struct __IOHIDEvent *IOHIDEventRef;

typedef IOHIDEventSystemClientRef (*fn_CreateClient)(CFAllocatorRef);
typedef void (*fn_SetMatching)(IOHIDEventSystemClientRef, CFDictionaryRef);
typedef CFArrayRef (*fn_CopyServices)(IOHIDEventSystemClientRef);
typedef CFTypeRef (*fn_CopyProperty)(IOHIDServiceClientRef, CFStringRef);
typedef IOHIDEventRef (*fn_CopyEvent)(IOHIDServiceClientRef, int64_t, int32_t, int64_t);
typedef double (*fn_GetFloatValue)(IOHIDEventRef, int32_t);

static fn_CreateClient pCreateClient = NULL;
static fn_SetMatching pSetMatching = NULL;
static fn_CopyServices pCopyServices = NULL;
static fn_CopyProperty pCopyProperty = NULL;
static fn_CopyEvent pCopyEvent = NULL;
static fn_GetFloatValue pGetFloatValue = NULL;
static IOHIDEventSystemClientRef gHidClient = NULL;
static CFArrayRef gThermalServices = NULL;
static uint8_t *gIsDieSensor = NULL;
static CFIndex gThermalCount = 0;

static void initThermalHid(void) {
    void *h = dlopen("/System/Library/Frameworks/IOKit.framework/IOKit", RTLD_LAZY);
    if (!h) return;
    pCreateClient = (fn_CreateClient)dlsym(h, "IOHIDEventSystemClientCreate");
    pSetMatching = (fn_SetMatching)dlsym(h, "IOHIDEventSystemClientSetMatching");
    pCopyServices = (fn_CopyServices)dlsym(h, "IOHIDEventSystemClientCopyServices");
    pCopyProperty = (fn_CopyProperty)dlsym(h, "IOHIDServiceClientCopyProperty");
    pCopyEvent = (fn_CopyEvent)dlsym(h, "IOHIDServiceClientCopyEvent");
    pGetFloatValue = (fn_GetFloatValue)dlsym(h, "IOHIDEventGetFloatValue");
    if (!pCreateClient || !pSetMatching || !pCopyServices || !pCopyProperty || !pCopyEvent || !pGetFloatValue) {
        return;
    }
    gHidClient = pCreateClient(kCFAllocatorDefault);
    if (!gHidClient) return;
    NSDictionary *match = @{ @"PrimaryUsagePage": @(0xff00), @"PrimaryUsage": @(5) };
    pSetMatching(gHidClient, (__bridge CFDictionaryRef)match);

    // Cache HID thermal service list & die-sensor flags once (avoids dozens of Mach IPC calls every tick!)
    gThermalServices = pCopyServices(gHidClient);
    if (!gThermalServices) return;
    gThermalCount = CFArrayGetCount(gThermalServices);
    if (gThermalCount > 0) {
        gIsDieSensor = (uint8_t *)calloc((size_t)gThermalCount, 1);
        for (CFIndex i = 0; i < gThermalCount; i++) {
            IOHIDServiceClientRef svc = (IOHIDServiceClientRef)CFArrayGetValueAtIndex(gThermalServices, i);
            if (!svc) continue;
            CFTypeRef prodRef = pCopyProperty(svc, CFSTR("Product"));
            if (prodRef && CFGetTypeID(prodRef) == CFStringGetTypeID()) {
                NSString *prod = (__bridge NSString *)prodRef;
                if ([prod containsString:@"tdie"] || [prod containsString:@"SOC MTR"] ||
                    [prod containsString:@"pACC"] || [prod containsString:@"eACC"]) {
                    gIsDieSensor[i] = 1;
                }
            }
            if (prodRef) CFRelease(prodRef);
        }
    }
}

static double sampleSocTempC(void) {
    if (!gThermalServices || gThermalCount <= 0) return -1.0;

    double sumDie = 0.0;
    int cntDie = 0;
    double sumAll = 0.0;
    int cntAll = 0;

    for (CFIndex i = 0; i < gThermalCount; i++) {
        IOHIDServiceClientRef svc = (IOHIDServiceClientRef)CFArrayGetValueAtIndex(gThermalServices, i);
        if (!svc) continue;
        // kIOHIDEventTypeTemperature = 15; kIOHIDEventFieldTemperatureLevel = 15 << 16
        IOHIDEventRef ev = pCopyEvent(svc, 15, 0, 0);
        if (!ev) continue;
        double temp = pGetFloatValue(ev, 15 << 16);
        CFRelease(ev);
        if (temp < 15.0 || temp > 125.0) continue;

        if (gIsDieSensor && gIsDieSensor[i]) {
            sumDie += temp;
            cntDie++;
        }
        sumAll += temp;
        cntAll++;
    }
    if (cntDie > 0) return sumDie / cntDie;
    if (cntAll > 0) return sumAll / cntAll;
    return -1.0;
}

typedef struct {
    double deviceUtil;   // 0..1
    double rendererUtil; // 0..1
    double tilerUtil;    // 0..1
    double memInUseGB;
    int gpuCores;
} GpuStats;

static GpuStats sampleGpuStats(void) {
    GpuStats st = {0.0, 0.0, 0.0, 0.0, 0};
    io_iterator_t iter = 0;
    kern_return_t kr = IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("IOAccelerator"), &iter);
    if (kr != KERN_SUCCESS) return st;

    io_registry_entry_t entry;
    while ((entry = IOIteratorNext(iter)) != 0) {
        CFMutableDictionaryRef props = NULL;
        if (IORegistryEntryCreateCFProperties(entry, &props, kCFAllocatorDefault, 0) == KERN_SUCCESS && props) {
            NSDictionary *dict = (__bridge_transfer NSDictionary *)props;
            NSNumber *cores = dict[@"gpu-core-count"];
            if (cores) st.gpuCores = [cores intValue];

            NSDictionary *perf = dict[@"PerformanceStatistics"];
            if ([perf isKindOfClass:[NSDictionary class]]) {
                NSNumber *dev = perf[@"Device Utilization %"];
                NSNumber *ren = perf[@"Renderer Utilization %"];
                NSNumber *til = perf[@"Tiler Utilization %"];
                NSNumber *mem = perf[@"In use system memory"];
                if (dev) st.deviceUtil = fmin(1.0, fmax(0.0, [dev doubleValue] / 100.0));
                if (ren) st.rendererUtil = fmin(1.0, fmax(0.0, [ren doubleValue] / 100.0));
                if (til) st.tilerUtil = fmin(1.0, fmax(0.0, [til doubleValue] / 100.0));
                if (mem) st.memInUseGB = [mem doubleValue] / (1024.0 * 1024.0 * 1024.0);
                IOObjectRelease(entry);
                break;
            }
        }
        IOObjectRelease(entry);
    }
    IOObjectRelease(iter);
    return st;
}

static uint64_t sampleNetBytes(void) {
    struct ifaddrs *ifap = NULL;
    if (getifaddrs(&ifap) != 0 || !ifap) return 0;
    uint64_t total = 0;
    for (struct ifaddrs *ifa = ifap; ifa != NULL; ifa = ifa->ifa_next) {
        if (!ifa->ifa_name || !ifa->ifa_addr || !ifa->ifa_data) continue;
        if (ifa->ifa_addr->sa_family != AF_LINK) continue;
        if (strncmp(ifa->ifa_name, "en", 2) != 0) continue;
        struct if_data *ifd = (struct if_data *)ifa->ifa_data;
        total += (uint64_t)ifd->ifi_ibytes + (uint64_t)ifd->ifi_obytes;
    }
    freeifaddrs(ifap);
    return total;
}

static double sampleMemUsedGB(double totalGB) {
    vm_statistics64_data_t vm;
    mach_msg_type_number_t count = HOST_VM_INFO64_COUNT;
    vm_size_t pageSize = 16384;
    host_page_size(mach_host_self(), &pageSize);
    if (host_statistics64(mach_host_self(), HOST_VM_INFO64, (host_info64_t)&vm, &count) == KERN_SUCCESS) {
        uint64_t usedPages = (uint64_t)vm.active_count + (uint64_t)vm.wire_count + (uint64_t)vm.compressor_page_count;
        double gb = ((double)usedPages * (double)pageSize) / (1024.0 * 1024.0 * 1024.0);
        return fmin(totalGB, fmax(0.0, gb));
    }
    return totalGB * 0.45;
}

static const char *thermalStateLabel(NSProcessInfoThermalState s) {
    switch (s) {
        case NSProcessInfoThermalStateNominal: return "Nominal";
        case NSProcessInfoThermalStateFair: return "Fair";
        case NSProcessInfoThermalStateSerious: return "Serious";
        case NSProcessInfoThermalStateCritical: return "Critical";
        default: return "Nominal";
    }
}

static int readSysctlInt(const char *name, int fallback) {
    int val = fallback;
    size_t sz = sizeof(val);
    if (sysctlbyname(name, &val, &sz, NULL, 0) == 0) return val;
    return fallback;
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        int intervalMs = 600;
        int once = 0;
        for (int i = 1; i < argc; i++) {
            if (strcmp(argv[i], "--once") == 0) once = 1;
            else if (strncmp(argv[i], "--ms=", 5) == 0) intervalMs = atoi(argv[i] + 5);
        }
        if (intervalMs < 150) intervalMs = 150;

        char brand[128] = "Apple Silicon";
        size_t bsz = sizeof(brand);
        sysctlbyname("machdep.cpu.brand_string", brand, &bsz, NULL, 0);

        int ncpu = readSysctlInt("hw.ncpu", 10);
        int pCores = readSysctlInt("hw.perflevel0.physicalcpu", 8);
        int eCores = readSysctlInt("hw.perflevel1.physicalcpu", 2);

        uint64_t memBytes = 0;
        size_t msz = sizeof(memBytes);
        sysctlbyname("hw.memsize", &memBytes, &msz, NULL, 0);
        double memTotalGB = (double)memBytes / (1024.0 * 1024.0 * 1024.0);

        initThermalHid();

        // Prime initial CPU ticks & net bytes
        natural_t numCpus = 0;
        processor_info_array_t prevInfo = NULL;
        mach_msg_type_number_t prevCount = 0;
        host_processor_info(mach_host_self(), PROCESSOR_CPU_LOAD_INFO, &numCpus, &prevInfo, &prevCount);

        uint64_t prevNet = sampleNetBytes();
        double prevTime = [[NSDate date] timeIntervalSince1970];

        if (once) {
            usleep(120 * 1000);
        }

        double cachedTempC = sampleSocTempC();
        int tempTick = 0;

        while (1) {
            if (!once) {
                usleep((useconds_t)(intervalMs * 1000));
            }
            @autoreleasepool {
                double now = [[NSDate date] timeIntervalSince1970];
                double dt = fmax(0.1, now - prevTime);
                prevTime = now;

                natural_t curCpus = 0;
                processor_info_array_t curInfo = NULL;
                mach_msg_type_number_t curCount = 0;
                kern_return_t kr = host_processor_info(mach_host_self(), PROCESSOR_CPU_LOAD_INFO, &curCpus, &curInfo, &curCount);

                NSMutableArray<NSNumber *> *loads = [NSMutableArray arrayWithCapacity:ncpu];
                if (kr == KERN_SUCCESS && prevInfo && curCpus == numCpus) {
                    for (natural_t i = 0; i < curCpus; i++) {
                        int base = i * CPU_STATE_MAX;
                        uint64_t dUser = (uint64_t)(curInfo[base + CPU_STATE_USER] - prevInfo[base + CPU_STATE_USER]);
                        uint64_t dSys  = (uint64_t)(curInfo[base + CPU_STATE_SYSTEM] - prevInfo[base + CPU_STATE_SYSTEM]);
                        uint64_t dNice = (uint64_t)(curInfo[base + CPU_STATE_NICE] - prevInfo[base + CPU_STATE_NICE]);
                        uint64_t dIdle = (uint64_t)(curInfo[base + CPU_STATE_IDLE] - prevInfo[base + CPU_STATE_IDLE]);
                        uint64_t tot = dUser + dSys + dNice + dIdle;
                        double u = tot > 0 ? (double)(dUser + dSys + dNice) / (double)tot : 0.0;
                        [loads addObject:@(fmin(1.0, fmax(0.0, u)))];
                    }
                    vm_deallocate(mach_task_self(), (vm_address_t)prevInfo, prevCount * sizeof(integer_t));
                    prevInfo = curInfo;
                    prevCount = curCount;
                } else {
                    if (curInfo) vm_deallocate(mach_task_self(), (vm_address_t)curInfo, curCount * sizeof(integer_t));
                    for (int i = 0; i < ncpu; i++) [loads addObject:@(0.1)];
                }

                uint64_t curNet = sampleNetBytes();
                double netKBps = 0.0;
                if (curNet >= prevNet && prevNet > 0) {
                    netKBps = ((double)(curNet - prevNet) / 1024.0) / dt;
                }
                prevNet = curNet;

                double memUsedGB = sampleMemUsedGB(memTotalGB);
                GpuStats gpu = sampleGpuStats();
                if ((tempTick++ & 1) == 0 || once) {
                    cachedTempC = sampleSocTempC();
                }
                double socTempC = cachedTempC;
                const char *thermState = thermalStateLabel([[NSProcessInfo processInfo] thermalState]);

                // Print compact NDJSON line
                printf("{\"chipName\":\"%s\",\"totalCores\":%d,\"pCoreCount\":%d,\"eCoreCount\":%d,\"gpuCores\":%d,\"coreLoads\":[",
                       brand, (int)loads.count, pCores, eCores, gpu.gpuCores);
                for (NSUInteger i = 0; i < loads.count; i++) {
                    printf("%s%.3f", i ? "," : "", [loads[i] doubleValue]);
                }
                printf("],\"memUsedGB\":%.1f,\"memTotalGB\":%.1f,\"netKBps\":%.1f,\"gpuUtil\":%.3f,\"gpuRenderer\":%.3f,\"gpuTiler\":%.3f,\"gpuMemGB\":%.2f,\"socTempC\":%.1f,\"thermalState\":\"%s\"}\n",
                       memUsedGB, memTotalGB, netKBps, gpu.deviceUtil, gpu.rendererUtil, gpu.tilerUtil, gpu.memInUseGB, socTempC, thermState);
                fflush(stdout);

                if (once) break;
            }
        }
    }
    return 0;
}
