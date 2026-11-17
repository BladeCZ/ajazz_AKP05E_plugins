$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'SilentlyContinue'

[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$hwNativeCode = @'
using System;
using System.IO;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
public struct ADLMemoryInfo {
    public long iMemorySize;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
    public string strMemoryType;
    public long iMemoryBandwidth;
}

[StructLayout(LayoutKind.Sequential)]
public struct MEMORYSTATUSEX {
    public uint dwLength;
    public uint dwMemoryLoad;
    public ulong ullTotalPhys;
    public ulong ullAvailPhys;
    public ulong ullTotalPageFile;
    public ulong ullAvailPageFile;
    public ulong ullTotalVirtual;
    public ulong ullAvailVirtual;
    public ulong ullAvailExtendedVirtual;
}

public static class HwNative {
    public delegate IntPtr ADL_Main_Memory_Alloc(int size);
    public static readonly ADL_Main_Memory_Alloc AllocDelegate = new ADL_Main_Memory_Alloc(AllocMem);

    private static IntPtr AllocMem(int size) {
        return Marshal.AllocHGlobal(size);
    }

    [DllImport("atiadlxx.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern int ADL2_Main_Control_Create(ADL_Main_Memory_Alloc callback, int enumConnectedAdapters, out IntPtr context);

    [DllImport("atiadlxx.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern int ADL2_Main_Control_Destroy(IntPtr context);

    [DllImport("atiadlxx.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern int ADL2_Adapter_NumberOfAdapters_Get(IntPtr context, out int numAdapters);

    [DllImport("atiadlxx.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern int ADL2_New_QueryPMLogData_Get(IntPtr context, int adapterIndex, byte[] pmLogDataOutput);

    [DllImport("atiadlxx.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern int ADL2_Adapter_DedicatedVRAMUsage_Get(IntPtr context, int adapterIndex, out int vramUsageInMB);

    [DllImport("atiadlxx.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern int ADL2_Adapter_MemoryInfo_Get(IntPtr context, int adapterIndex, out ADLMemoryInfo info);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX lpBuffer);

    private static IntPtr _adlCtx = IntPtr.Zero;
    private static int _gpuAdapter = -1;
    private static long _vramTotalBytes = 0;

    public static bool EnsureAdl() {
        if (_adlCtx != IntPtr.Zero && _gpuAdapter >= 0) return true;
        try {
            if (_adlCtx != IntPtr.Zero) {
                try { ADL2_Main_Control_Destroy(_adlCtx); } catch {}
                _adlCtx = IntPtr.Zero;
            }
            IntPtr ctx = IntPtr.Zero;
            if (ADL2_Main_Control_Create(AllocDelegate, 1, out ctx) != 0 || ctx == IntPtr.Zero) {
                return false;
            }
            int count = 0;
            if (ADL2_Adapter_NumberOfAdapters_Get(ctx, out count) != 0 || count <= 0) {
                ADL2_Main_Control_Destroy(ctx);
                return false;
            }
            byte[] buf = new byte[4096];
            int bestIdx = -1;
            int bestDed = -1;
            for (int i = 0; i < count; i++) {
                if (ADL2_New_QueryPMLogData_Get(ctx, i, buf) == 0) {
                    int supClock = BitConverter.ToInt32(buf, 4 + 1 * 8);
                    int supTemp = BitConverter.ToInt32(buf, 4 + 8 * 8);
                    int ded = 0;
                    int rDed = ADL2_Adapter_DedicatedVRAMUsage_Get(ctx, i, out ded);
                    if (supClock != 0 || supTemp != 0 || rDed == 0) {
                        if (bestIdx < 0 || (rDed == 0 && ded > bestDed)) {
                            bestIdx = i;
                            bestDed = (rDed == 0) ? ded : 0;
                        }
                    }
                }
            }
            if (bestIdx < 0) {
                ADL2_Main_Control_Destroy(ctx);
                return false;
            }
            _adlCtx = ctx;
            _gpuAdapter = bestIdx;
            try {
                ADLMemoryInfo mi = new ADLMemoryInfo();
                if (ADL2_Adapter_MemoryInfo_Get(ctx, bestIdx, out mi) == 0 && mi.iMemorySize > 0) {
                    _vramTotalBytes = mi.iMemorySize;
                }
            } catch {}
            return true;
        } catch {
            return false;
        }
    }

    public static void ShutdownAdl() {
        if (_adlCtx != IntPtr.Zero) {
            try { ADL2_Main_Control_Destroy(_adlCtx); } catch {}
            _adlCtx = IntPtr.Zero;
            _gpuAdapter = -1;
        }
    }

    public static bool ReadGpu(
        out int usage,
        out int temp,
        out int hotspot,
        out int memTemp,
        out int powerW,
        out int clockMhz,
        out int memClockMhz,
        out int fanRpm,
        out int fanPct,
        out int memCtrlPct,
        out int voltMv,
        out int vramUsedMb,
        out int vramTotalMb
    ) {
        usage = 0; temp = 0; hotspot = 0; memTemp = 0; powerW = 0;
        clockMhz = 0; memClockMhz = 0; fanRpm = 0; fanPct = 0;
        memCtrlPct = 0; voltMv = 0; vramUsedMb = 0; vramTotalMb = 16384;

        if (!EnsureAdl()) return false;

        byte[] buf = new byte[4096];
        int rc = ADL2_New_QueryPMLogData_Get(_adlCtx, _gpuAdapter, buf);
        if (rc != 0) {
            ShutdownAdl();
            if (!EnsureAdl()) return false;
            rc = ADL2_New_QueryPMLogData_Get(_adlCtx, _gpuAdapter, buf);
            if (rc != 0) return false;
        }

        // ADLPMLogSensors indices confirmed on hardware:
        // 1=GFXCLK, 2=MEMCLK, 8=EDGE_TEMP, 9=MEM_TEMP, 14=FAN_RPM, 15=FAN_PCT,
        // 19=GFX_ACTIVITY, 20=MEM_ACTIVITY, 21=GFX_VOLT_MV, 27=HOTSPOT_TEMP, 73=BOARD_POWER
        clockMhz    = ReadSensor(buf, 1);
        memClockMhz = ReadSensor(buf, 2);
        temp        = ReadSensor(buf, 8);
        memTemp     = ReadSensor(buf, 9);
        fanRpm      = ReadSensor(buf, 14);
        fanPct      = ReadSensor(buf, 15);
        usage       = ReadSensor(buf, 19);
        memCtrlPct  = ReadSensor(buf, 20);
        voltMv      = ReadSensor(buf, 21);
        hotspot     = ReadSensor(buf, 27);
        powerW      = ReadSensor(buf, 73);

        int ded = 0;
        if (ADL2_Adapter_DedicatedVRAMUsage_Get(_adlCtx, _gpuAdapter, out ded) == 0 && ded >= 0) {
            vramUsedMb = ded;
        }
        if (_vramTotalBytes > 0) {
            vramTotalMb = (int)(_vramTotalBytes / (1024L * 1024L));
        }
        return true;
    }

    private static int ReadSensor(byte[] buf, int id) {
        int off = 4 + id * 8;
        if (off + 8 > buf.Length) return 0;
        int supported = BitConverter.ToInt32(buf, off);
        if (supported == 0) return 0;
        return BitConverter.ToInt32(buf, off + 4);
    }

    public static void ReadMemory(out uint loadPct, out double totalGb, out double usedGb, out double freeGb) {
        MEMORYSTATUSEX ms = new MEMORYSTATUSEX();
        ms.dwLength = (uint)Marshal.SizeOf(typeof(MEMORYSTATUSEX));
        if (GlobalMemoryStatusEx(ref ms)) {
            loadPct = ms.dwMemoryLoad;
            totalGb = ms.ullTotalPhys / (1024.0 * 1024.0 * 1024.0);
            freeGb = ms.ullAvailPhys / (1024.0 * 1024.0 * 1024.0);
            usedGb = totalGb - freeGb;
        } else {
            loadPct = 0; totalGb = 0; usedGb = 0; freeGb = 0;
        }
    }
}
'@

Add-Type -TypeDefinition $hwNativeCode -Language CSharp | Out-Null

$sysMonLog = Join-Path $env:APPDATA 'HotSpot\StreamDock\plugins\com.hotspot.streamdock.system.monitor.sdPlugin\log.txt'
$inv = [System.Globalization.CultureInfo]::InvariantCulture

# Initialize Performance Counters
$pcCpuTime = $null; $pcCpuUtil = $null; $pcCpuFreq = $null; $pcCpuPerf = $null
$pcDiskPct = $null; $pcDiskRead = $null; $pcDiskWrite = $null
try {
    $pcCpuTime = New-Object System.Diagnostics.PerformanceCounter("Processor Information", "% Processor Time", "_Total")
    $pcCpuUtil = New-Object System.Diagnostics.PerformanceCounter("Processor Information", "% Processor Utility", "_Total")
    $pcCpuFreq = New-Object System.Diagnostics.PerformanceCounter("Processor Information", "Processor Frequency", "_Total")
    $pcCpuPerf = New-Object System.Diagnostics.PerformanceCounter("Processor Information", "% Processor Performance", "_Total")
    $pcDiskPct = New-Object System.Diagnostics.PerformanceCounter("PhysicalDisk", "% Disk Time", "_Total")
    $pcDiskRead = New-Object System.Diagnostics.PerformanceCounter("PhysicalDisk", "Disk Read Bytes/sec", "_Total")
    $pcDiskWrite = New-Object System.Diagnostics.PerformanceCounter("PhysicalDisk", "Disk Write Bytes/sec", "_Total")
    $null = $pcCpuTime.NextValue()
    $null = $pcCpuUtil.NextValue()
    $null = $pcCpuPerf.NextValue()
    $null = $pcDiskPct.NextValue()
    $null = $pcDiskRead.NextValue()
    $null = $pcDiskWrite.NextValue()
} catch {}

# Network baseline
$script:prevNetTime = [DateTime]::UtcNow
$script:prevNetRx = 0L
$script:prevNetTx = 0L
function Get-NetTotals {
    $rx = 0L; $tx = 0L
    try {
        foreach ($nic in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
            if ($nic.OperationalStatus -eq [System.Net.NetworkInformation.OperationalStatus]::Up -and
                $nic.NetworkInterfaceType -ne [System.Net.NetworkInformation.NetworkInterfaceType]::Loopback) {
                $st = $nic.GetIPv4Statistics()
                $rx += $st.BytesReceived
                $tx += $st.BytesSent
            }
        }
    } catch {}
    return @($rx, $tx)
}
$initNet = Get-NetTotals
$script:prevNetRx = $initNet[0]
$script:prevNetTx = $initNet[1]

# Brief warm-up so first --oneshot poll gets real rate deltas
[System.Threading.Thread]::Sleep(150)

# HWiNFO log cache
$script:hwScannedPos = 0L
$script:hwState = @{
    ddr_temp1 = 0.0
    ddr_temp2 = 0.0
    ddr_temp = 0.0
    ddr_power = 0.0
    ram_clock = 2400.0
    ddr_mts = 4800.0
    vrm_temp = 0.0
    mb_temp = 0.0
    chipset_temp = 0.0
    ssd_c_temp = 0.0
    ssd_f_temp = 0.0
    cpu_volt = 1.25
    cpu_base_power = 50.0
    cpu_base_util = 25.0
    last_cpu_temp = 55.0
    hwinfo_ts = ''
}

function Parse-HWiNFOJson($jsonLine) {
    try {
        $doc = $jsonLine | ConvertFrom-Json
        if ($null -eq $doc) { return }
        foreach ($prop in $doc.PSObject.Properties) {
            $secName = $prop.Name
            $sec = $prop.Value
            if ($secName -like 'DDR5 DIMM*#1*') {
                if ($sec.'SPD Hub Temperature'.value) { $script:hwState.ddr_temp1 = [double]$sec.'SPD Hub Temperature'.value }
                if ($sec.'Total Power'.value -ne $null) { $p1 = [double]$sec.'Total Power'.value; $script:hwState._p1 = $p1 }
            } elseif ($secName -like 'DDR5 DIMM*#3*') {
                if ($sec.'SPD Hub Temperature'.value) { $script:hwState.ddr_temp2 = [double]$sec.'SPD Hub Temperature'.value }
                if ($sec.'Total Power'.value -ne $null) { $p2 = [double]$sec.'Total Power'.value; $script:hwState._p2 = $p2 }
            } elseif ($secName -eq 'Memory Timings') {
                if ($sec.'Memory Clock'.value) {
                    $mc = [double]$sec.'Memory Clock'.value
                    $script:hwState.ram_clock = $mc
                    $script:hwState.ddr_mts = $mc * 2.0
                }
            } elseif ($secName -like '*Nuvoton*' -or ($secName -like '*ASUS*' -and $sec.'VRM')) {
                if ($sec.VRM.value) { $script:hwState.vrm_temp = [double]$sec.VRM.value }
                if ($sec.Motherboard.value) { $script:hwState.mb_temp = [double]$sec.Motherboard.value }
                if ($sec.'CPU Package'.value) { $script:hwState.last_cpu_temp = [double]$sec.'CPU Package'.value }
            } elseif ($secName -like '*AMD Chipset*') {
                if ($sec.'Chipset 1 (xHCI)'.value) { $script:hwState.chipset_temp = [double]$sec.'Chipset 1 (xHCI)'.value }
            } elseif ($secName -like 'CPU*Enhanced*') {
                if ($sec.'CPU Package Power'.value) { $script:hwState.cpu_base_power = [double]$sec.'CPU Package Power'.value }
                if ($sec.'CPU VDDCR_VDD Voltage (SVI3 TFN)'.value) { $script:hwState.cpu_volt = [double]$sec.'CPU VDDCR_VDD Voltage (SVI3 TFN)'.value }
            } elseif ($secName -like 'CPU*' -and $secName -notlike '*C-State*') {
                if ($sec.'Total CPU Utility'.value) { $script:hwState.cpu_base_util = [double]$sec.'Total CPU Utility'.value }
            } elseif ($secName -like 'S.M.A.R.T.*`[C:`]*') {
                if ($sec.'Drive Temperature'.value) { $script:hwState.ssd_c_temp = [double]$sec.'Drive Temperature'.value }
            } elseif ($secName -like 'S.M.A.R.T.*`[F:`]*') {
                if ($sec.'Drive Temperature'.value) { $script:hwState.ssd_f_temp = [double]$sec.'Drive Temperature'.value }
            }
        }
        $t1 = [double]$script:hwState.ddr_temp1
        $t2 = [double]$script:hwState.ddr_temp2
        if ($t1 -gt 0 -and $t2 -gt 0) {
            $script:hwState.ddr_temp = [Math]::Max($t1, $t2)
        } elseif ($t1 -gt 0) {
            $script:hwState.ddr_temp = $t1
        } elseif ($t2 -gt 0) {
            $script:hwState.ddr_temp = $t2
        }
        $p1v = if ($script:hwState.ContainsKey('_p1')) { [double]$script:hwState._p1 } else { 0.0 }
        $p2v = if ($script:hwState.ContainsKey('_p2')) { [double]$script:hwState._p2 } else { 0.0 }
        if ($p1v -gt 0 -or $p2v -gt 0) {
            $script:hwState.ddr_power = $p1v + $p2v
        }
    } catch {}
}

function Update-HWiNFOCache {
    if (-not (Test-Path -LiteralPath $sysMonLog)) { return }
    $fs = $null
    try {
        $fs = [System.IO.File]::Open($sysMonLog, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        $len = $fs.Length
        if ($len -lt $script:hwScannedPos) { $script:hwScannedPos = 0L }

        if ($len -gt $script:hwScannedPos) {
            # On initial run or when new lines appear, scan from hwScannedPos to find any getAllSensorData JSON
            $fs.Seek($script:hwScannedPos, [System.IO.SeekOrigin]::Begin) | Out-Null
            $sr = New-Object System.IO.StreamReader($fs, [System.Text.Encoding]::UTF8, $false, 65536, $true)
            $expectJson = $false
            $lastJson = $null
            $lastTs = ''
            while ($null -ne ($ln = $sr.ReadLine())) {
                if ($expectJson) {
                    if ($ln.StartsWith('{')) { $lastJson = $ln }
                    $expectJson = $false
                } elseif ($ln -match '^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\].*getAllSensorData:') {
                    $expectJson = $true
                    $lastTs = $Matches[1]
                }
            }
            $script:hwScannedPos = $fs.Position
            if ($null -ne $lastJson) {
                Parse-HWiNFOJson $lastJson
                $script:hwState.hwinfo_ts = $lastTs
            }
        }
    } catch {
    } finally {
        if ($null -ne $fs) { $fs.Dispose() }
    }
}

function Read-LiveCpuTempFromLog {
    if (-not (Test-Path -LiteralPath $sysMonLog)) { return @($false, 0.0) }
    $fs = $null
    try {
        $fs = [System.IO.File]::Open($sysMonLog, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        $seekPos = [Math]::Max(0L, $fs.Length - 1024L)
        $fs.Seek($seekPos, [System.IO.SeekOrigin]::Begin) | Out-Null
        $sr = New-Object System.IO.StreamReader($fs, [System.Text.Encoding]::UTF8, $false, 1024, $true)
        $tail = $sr.ReadToEnd()
        $ms = [regex]::Matches($tail, '\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\][^\r\n]*cpuPackageObject:\s*\r?\n\{"units":"[^"]*","value":([0-9.]+)\}')
        if ($ms.Count -gt 0) {
            $last = $ms[$ms.Count - 1]
            $tsStr = $last.Groups[1].Value
            $val = 0.0
            [void][double]::TryParse($last.Groups[2].Value, [System.Globalization.NumberStyles]::Float, $inv, [ref]$val)
            $ts = [DateTime]::MinValue
            if ([DateTime]::TryParseExact($tsStr, 'yyyy-MM-dd HH:mm:ss', $inv, [System.Globalization.DateTimeStyles]::None, [ref]$ts)) {
                $ageSec = ([DateTime]::Now - $ts).TotalSeconds
                if ($ageSec -lt 25 -and $val -gt 0) {
                    $script:hwState.last_cpu_temp = $val
                    return @($true, $val)
                }
            }
        }
    } catch {
    } finally {
        if ($null -ne $fs) { $fs.Dispose() }
    }
    return @($false, 0.0)
}

function Emit-Sensors {
    Update-HWiNFOCache

    # 1. GPU via ADL2
    [int]$gUsage = 0; [int]$gTemp = 0; [int]$gHot = 0; [int]$gMemT = 0; [int]$gPower = 0
    [int]$gClk = 0; [int]$gMemClk = 0; [int]$gFanRpm = 0; [int]$gFanPct = 0
    [int]$gMemCtrl = 0; [int]$gVoltMv = 0; [int]$vramUsedMb = 0; [int]$vramTotalMb = 16384
    $gpuOk = [HwNative]::ReadGpu(
        [ref]$gUsage, [ref]$gTemp, [ref]$gHot, [ref]$gMemT, [ref]$gPower,
        [ref]$gClk, [ref]$gMemClk, [ref]$gFanRpm, [ref]$gFanPct,
        [ref]$gMemCtrl, [ref]$gVoltMv, [ref]$vramUsedMb, [ref]$vramTotalMb
    )

    # 2. RAM via GlobalMemoryStatusEx
    [uint32]$ramPct = 0; [double]$ramTotalGb = 0; [double]$ramUsedGb = 0; [double]$ramFreeGb = 0
    [HwNative]::ReadMemory([ref]$ramPct, [ref]$ramTotalGb, [ref]$ramUsedGb, [ref]$ramFreeGb)

    # 3. CPU & Disk via PerformanceCounter
    $cpuUsage = 0.0; $cpuUtil = 0.0; $cpuClock = 4700.0
    $diskPct = 0.0; $diskReadMb = 0.0; $diskWriteMb = 0.0
    if ($null -ne $pcCpuTime) {
        try {
            $cpuUsage = [Math]::Min(100.0, [Math]::Max(0.0, [double]$pcCpuTime.NextValue()))
            $cpuUtilRaw = [double]$pcCpuUtil.NextValue()
            $cpuUtil = [Math]::Min(100.0, [Math]::Max(0.0, $cpuUtilRaw))
            $baseFreq = [double]$pcCpuFreq.NextValue()
            $perfPct = [double]$pcCpuPerf.NextValue()
            if ($baseFreq -gt 0 -and $perfPct -gt 0) {
                $cpuClock = $baseFreq * ($perfPct / 100.0)
            } elseif ($baseFreq -gt 0) {
                $cpuClock = $baseFreq
            }
            $diskPct = [Math]::Min(100.0, [Math]::Max(0.0, [double]$pcDiskPct.NextValue()))
            $diskReadMb = [Math]::Max(0.0, [double]$pcDiskRead.NextValue() / 1048576.0)
            $diskWriteMb = [Math]::Max(0.0, [double]$pcDiskWrite.NextValue() / 1048576.0)
        } catch {}
    }

    # 4. Live CPU temp from SystemMonitor log or fallback estimate
    $liveCpu = Read-LiveCpuTempFromLog
    $cpuTempLive = [bool]$liveCpu[0]
    $cpuTemp = if ($cpuTempLive) { [double]$liveCpu[1] } else { [Math]::Round((39.0 + 0.52 * $cpuUtil), 1) }

    # Estimate dynamic CPU Package Power smoothly anchored to HWiNFO baseline
    $baseW = [double]$script:hwState.cpu_base_power
    $baseU = [double]$script:hwState.cpu_base_util
    if ($baseW -lt 15) { $baseW = 45.0 }
    if ($baseU -lt 5) { $baseU = 20.0 }
    # Idle ~24W + dynamic load power matching HWiNFO observation
    $slope = [Math]::Max(0.7, ($baseW - 24.0) / $baseU)
    $cpuPower = [Math]::Min(162.0, [Math]::Max(22.0, 24.0 + $slope * $cpuUtil))

    # 5. Network throughput delta
    $nowUtc = [DateTime]::UtcNow
    $dt = ($nowUtc - $script:prevNetTime).TotalSeconds
    if ($dt -lt 0.05) { $dt = 0.05 }
    $curNet = Get-NetTotals
    $dlDelta = [Math]::Max(0L, $curNet[0] - $script:prevNetRx)
    $ulDelta = [Math]::Max(0L, $curNet[1] - $script:prevNetTx)
    $script:prevNetTime = $nowUtc
    $script:prevNetRx = $curNet[0]
    $script:prevNetTx = $curNet[1]
    $netDlKbs = ($dlDelta / 1024.0) / $dt
    $netUlKbs = ($ulDelta / 1024.0) / $dt
    $netTotalMbps = (($dlDelta + $ulDelta) * 8.0) / ($dt * 1000000.0)

    # 6. C: drive space
    $cFreeGb = 0.0; $cUsedPct = 0.0
    try {
        $di = [System.IO.DriveInfo]::new('C')
        if ($di.IsReady -and $di.TotalSize -gt 0) {
            $cFreeGb = $di.AvailableFreeSpace / 1073741824.0
            $cUsedPct = 100.0 * (1.0 - ($di.AvailableFreeSpace / [double]$di.TotalSize))
        }
    } catch {}

    $vramPct = if ($vramTotalMb -gt 0) { [Math]::Min(100.0, (100.0 * $vramUsedMb / [double]$vramTotalMb)) } else { 0.0 }

    $out = [ordered]@{
        ok             = $true
        ts             = [DateTime]::Now.ToString('HH:mm:ss')
        cpu_usage      = [Math]::Round($cpuUsage, 1)
        cpu_util       = [Math]::Round($cpuUtil, 1)
        cpu_temp       = [Math]::Round($cpuTemp, 1)
        cpu_temp_live  = $cpuTempLive
        cpu_power      = [Math]::Round($cpuPower, 1)
        cpu_clock      = [Math]::Round($cpuClock, 0)
        cpu_volt       = [Math]::Round([double]$script:hwState.cpu_volt, 3)

        gpu_ok         = [bool]$gpuOk
        gpu_usage      = $gUsage
        gpu_temp       = $gTemp
        gpu_hotspot    = $gHot
        gpu_mem_temp   = $gMemT
        gpu_power      = $gPower
        gpu_clock      = $gClk
        gpu_mem_clock  = $gMemClk
        gpu_mem_ctrl   = $gMemCtrl
        gpu_fan_rpm    = $gFanRpm
        gpu_fan_pct    = $gFanPct
        gpu_volt       = [Math]::Round($gVoltMv / 1000.0, 3)

        vram_used_mb   = $vramUsedMb
        vram_used_gb   = [Math]::Round($vramUsedMb / 1024.0, 2)
        vram_total_gb  = [Math]::Round($vramTotalMb / 1024.0, 1)
        vram_pct       = [Math]::Round($vramPct, 1)

        ram_pct        = [double]$ramPct
        ram_used_gb    = [Math]::Round($ramUsedGb, 1)
        ram_free_gb    = [Math]::Round($ramFreeGb, 1)
        ram_total_gb   = [Math]::Round($ramTotalGb, 1)
        ddr_temp       = [Math]::Round([double]$script:hwState.ddr_temp, 1)
        ddr_temp1      = [Math]::Round([double]$script:hwState.ddr_temp1, 1)
        ddr_temp2      = [Math]::Round([double]$script:hwState.ddr_temp2, 1)
        ddr_power      = [Math]::Round([double]$script:hwState.ddr_power, 2)
        ram_clock      = [Math]::Round([double]$script:hwState.ram_clock, 0)
        ddr_mts        = [Math]::Round([double]$script:hwState.ddr_mts, 0)

        vrm_temp       = [Math]::Round([double]$script:hwState.vrm_temp, 1)
        mb_temp        = [Math]::Round([double]$script:hwState.mb_temp, 1)
        chipset_temp   = [Math]::Round([double]$script:hwState.chipset_temp, 1)

        disk_pct       = [Math]::Round($diskPct, 1)
        disk_read_mb   = [Math]::Round($diskReadMb, 2)
        disk_write_mb  = [Math]::Round($diskWriteMb, 2)
        ssd_c_temp     = [Math]::Round([double]$script:hwState.ssd_c_temp, 1)
        ssd_f_temp     = [Math]::Round([double]$script:hwState.ssd_f_temp, 1)
        c_free_gb      = [Math]::Round($cFreeGb, 1)
        c_used_pct     = [Math]::Round($cUsedPct, 1)

        net_dl_kbs     = [Math]::Round($netDlKbs, 1)
        net_ul_kbs     = [Math]::Round($netUlKbs, 1)
        net_total_mbps = [Math]::Round($netTotalMbps, 2)
        hwinfo_ts      = $script:hwState.hwinfo_ts
    }

    [Console]::Out.WriteLine(($out | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
}

Emit-Sensors

while ($null -ne ($line = [Console]::In.ReadLine())) {
    $cmd = $line.Trim().ToUpperInvariant()
    if ($cmd -eq 'POLL') {
        Emit-Sensors
    } elseif ($cmd -eq 'QUIT') {
        break
    }
}

[HwNative]::ShutdownAdl()
