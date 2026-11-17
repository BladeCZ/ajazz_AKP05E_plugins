$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'SilentlyContinue'

[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IInputStream, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$braveMixerSource = @'
using System;
using System.Diagnostics;
using System.Collections.Generic;
using System.Runtime.InteropServices;

[Guid("BCDE0395-E52F-467C-8E3D-C4579291692E"), ComImport]
internal class MMDeviceEnumeratorComObject { }

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int dwStateMask, out IMMDeviceCollection ppDevices);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppEndpoint);
}

[Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDeviceCollection {
    int GetCount(out uint pcDevices);
    int Item(uint nDevice, out IMMDevice ppDevice);
}

[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDevice {
    int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
}

[Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioSessionManager2 {
    int GetAudioSessionControl(IntPtr AudioSessionGuid, int StreamFlags, out IntPtr SessionControl);
    int GetSimpleAudioVolume(IntPtr AudioSessionGuid, int StreamFlags, out IntPtr AudioVolume);
    int GetSessionEnumerator(out IAudioSessionEnumerator SessionEnum);
}

[Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioSessionEnumerator {
    int GetCount(out int SessionCount);
    int GetSession(int SessionCount, out IAudioSessionControl2 Session);
}

[Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioSessionControl2 {
    int GetState(out int pRetVal);
    int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
    int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string Value, ref Guid EventContext);
    int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
    int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string Value, ref Guid EventContext);
    int GetGroupingParam(out Guid pRetVal);
    int SetGroupingParam(ref Guid Override, ref Guid EventContext);
    int RegisterAudioSessionNotification(IntPtr NewNotifications);
    int UnregisterAudioSessionNotification(IntPtr NewNotifications);
    int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
    int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
    int GetProcessId(out uint pRetVal);
    int IsSystemSoundsSession();
    int SetDuckingPreference(bool optOut);
}

[Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface ISimpleAudioVolume {
    int SetMasterVolume(float fLevel, ref Guid EventContext);
    int GetMasterVolume(out float pfLevel);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid EventContext);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool pbMute);
}

public static class BraveAudioMixer {
    private static List<ISimpleAudioVolume> GetBraveVolumes(out int activeIdx) {
        activeIdx = -1;
        var list = new List<ISimpleAudioVolume>();
        try {
            var bravePids = new HashSet<uint>();
            foreach (var p in Process.GetProcessesByName("brave")) {
                bravePids.Add((uint)p.Id);
            }

            var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
            IMMDeviceCollection col;
            if (enumerator.EnumAudioEndpoints(0, 1, out col) != 0 || col == null) return list;
            uint devCount;
            col.GetCount(out devCount);

            Guid iidMgr = typeof(IAudioSessionManager2).GUID;
            for (uint d = 0; d < devCount; d++) {
                IMMDevice dev;
                if (col.Item(d, out dev) != 0 || dev == null) continue;
                object objMgr;
                if (dev.Activate(ref iidMgr, 23, IntPtr.Zero, out objMgr) == 0 && objMgr != null) {
                    var mgr = (IAudioSessionManager2)objMgr;
                    IAudioSessionEnumerator sEnum;
                    if (mgr.GetSessionEnumerator(out sEnum) == 0 && sEnum != null) {
                        int sCount;
                        sEnum.GetCount(out sCount);
                        for (int i = 0; i < sCount; i++) {
                            IAudioSessionControl2 ctl;
                            if (sEnum.GetSession(i, out ctl) == 0 && ctl != null) {
                                uint pid;
                                ctl.GetProcessId(out pid);
                                string sid;
                                ctl.GetSessionIdentifier(out sid);
                                if (bravePids.Contains(pid) || (sid != null && sid.IndexOf("brave.exe", StringComparison.OrdinalIgnoreCase) >= 0)) {
                                    var vol = ctl as ISimpleAudioVolume;
                                    if (vol != null) {
                                        int st;
                                        ctl.GetState(out st);
                                        if (st == 1 && activeIdx < 0) activeIdx = list.Count;
                                        list.Add(vol);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } catch {
            // Audio device enumeration may fail transiently during endpoint changes
        }
        return list;
    }

    public static int GetVolume(out bool muted) {
        muted = false;
        int activeIdx;
        var vols = GetBraveVolumes(out activeIdx);
        if (vols.Count == 0) return -1;
        var target = vols[activeIdx >= 0 ? activeIdx : 0];
        float level;
        target.GetMasterVolume(out level);
        target.GetMute(out muted);
        return (int)Math.Round(level * 100.0f);
    }

    public static int AdjustVolume(int deltaPercent, out bool muted) {
        muted = false;
        int activeIdx;
        var vols = GetBraveVolumes(out activeIdx);
        if (vols.Count == 0) return -1;
        var primary = vols[activeIdx >= 0 ? activeIdx : 0];
        float current;
        primary.GetMasterVolume(out current);
        float next = Math.Max(0.0f, Math.Min(1.0f, (float)Math.Round(current * 100.0f + deltaPercent) / 100.0f));
        Guid ctx = Guid.Empty;
        foreach (var v in vols) {
            v.SetMasterVolume(next, ref ctx);
            if (deltaPercent > 0) v.SetMute(false, ref ctx);
        }
        primary.GetMute(out muted);
        return (int)Math.Round(next * 100.0f);
    }

    public static bool ToggleMute(out int volume) {
        volume = -1;
        int activeIdx;
        var vols = GetBraveVolumes(out activeIdx);
        if (vols.Count == 0) return false;
        var primary = vols[activeIdx >= 0 ? activeIdx : 0];
        bool curMute;
        float curVol;
        primary.GetMute(out curMute);
        primary.GetMasterVolume(out curVol);
        bool nextMute = !curMute;
        Guid ctx = Guid.Empty;
        foreach (var v in vols) {
            v.SetMute(nextMute, ref ctx);
        }
        volume = (int)Math.Round(curVol * 100.0f);
        return nextMute;
    }
}
'@

if (-not ([System.Management.Automation.PSTypeName]'BraveAudioMixer').Type) {
    Add-Type -TypeDefinition $braveMixerSource
}

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name.StartsWith('IAsyncOperation')
})[0]

$asStreamMethod = ([System.IO.WindowsRuntimeStreamExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsStreamForRead' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IInputStream'
})[0]

function Await($WinRtTask, $ResultType) {
    if ($null -eq $WinRtTask) { return $null }
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    if ($null -eq $netTask) { return $null }
    $netTask.Wait(2000) | Out-Null
    if ($netTask.IsCompleted -and -not $netTask.IsFaulted) {
        return $netTask.Result
    }
    return $null
}

$script:mgr = $null
$script:lastThumbKey = ''
$script:lastThumbLoaded = $false

function Ensure-Manager {
    if ($null -eq $script:mgr) {
        $script:mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    }
    return $script:mgr
}

function Clean-Suffix([string]$val) {
    if ([string]::IsNullOrWhiteSpace($val)) { return '' }
    return ($val -replace '\s*-\s*Brave\s*$', '').Trim()
}

function Get-ThumbnailDataUri($thumbRef) {
    if ($null -eq $thumbRef -or $null -eq $asStreamMethod) { return '' }
    $netStream = $null
    $ms = $null
    try {
        $ras = Await ($thumbRef.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
        if ($null -eq $ras) { return '' }
        $netStream = $asStreamMethod.Invoke($null, @($ras))
        if ($null -eq $netStream) { return '' }
        $ms = New-Object System.IO.MemoryStream
        $netStream.CopyTo($ms)
        $bytes = $ms.ToArray()
        if ($null -eq $bytes -or $bytes.Length -eq 0) { return '' }
        $mime = 'image/jpeg'
        if ($bytes[0] -eq 0x89) {
            $mime = 'image/png'
        } elseif ($bytes[0] -eq 0xFF) {
            $mime = 'image/jpeg'
        } elseif ($bytes[0] -eq 0x52) {
            $mime = 'image/webp'
        }
        return "data:$mime;base64," + [Convert]::ToBase64String($bytes)
    } catch {
        return ''
    } finally {
        if ($null -ne $ms) { $ms.Dispose() }
        if ($null -ne $netStream) { $netStream.Dispose() }
    }
}

function Get-BraveSession {
    $m = Ensure-Manager
    if ($null -eq $m) { return $null }
    $all = @($m.GetSessions() | Where-Object { $_.SourceAppUserModelId -match '(?i)brave' })
    if ($all.Count -eq 0) { return $null }

    foreach ($s in $all) {
        $pb = $s.GetPlaybackInfo()
        if ($pb -and ([string]$pb.PlaybackStatus -eq 'Playing')) {
            return $s
        }
    }

    foreach ($s in $all) {
        $props = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
        if ($props -and -not [string]::IsNullOrWhiteSpace([string]$props.Title)) {
            return $s
        }
    }

    return $all[0]
}

function Emit-Status {
    $muted = $false
    $vol = [BraveAudioMixer]::GetVolume([ref]$muted)

    $session = Get-BraveSession
    if ($null -ne $session) {
        $pb = $session.GetPlaybackInfo()
        $status = if ($pb) { [string]$pb.PlaybackStatus } else { 'Unknown' }
        $props = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
        $title = if ($props -and $props.Title) { Clean-Suffix ([string]$props.Title) } else { '' }
        $artist = if ($props -and $props.Artist) { Clean-Suffix ([string]$props.Artist) } else { '' }
        $active = ($title.Length -gt 0) -and ($status -eq 'Playing' -or $status -eq 'Paused')

        $posSec = 0.0
        $endSec = 0.0
        $tl = $session.GetTimelineProperties()
        if ($null -ne $tl) {
            $endSec = [Math]::Max(0.0, [double]$tl.EndTime.TotalSeconds)
            $posSec = [Math]::Max(0.0, [double]$tl.Position.TotalSeconds)
            if ($status -eq 'Playing' -and $endSec -gt 0 -and $tl.LastUpdatedTime.Year -gt 2000) {
                $elapsed = ([DateTimeOffset]::UtcNow - $tl.LastUpdatedTime).TotalSeconds
                if ($elapsed -gt 0 -and $elapsed -lt 3600) {
                    $posSec = [Math]::Min($endSec, $posSec + $elapsed)
                }
            }
        }

        $thumbOut = $null
        if ($active) {
            $thumbKey = "$title|$artist"
            if ($thumbKey -ne $script:lastThumbKey -or (-not $script:lastThumbLoaded -and $null -ne $props.Thumbnail)) {
                $dataUri = ''
                if ($null -ne $props.Thumbnail) {
                    $dataUri = Get-ThumbnailDataUri $props.Thumbnail
                }
                $thumbOut = $dataUri
                $script:lastThumbKey = $thumbKey
                $script:lastThumbLoaded = ($dataUri.Length -gt 0)
            }
        } else {
            $script:lastThumbKey = ''
            $script:lastThumbLoaded = $false
        }

        $obj = [ordered]@{
            ok        = $true
            found     = $active
            status    = $status
            title     = $title
            artist    = $artist
            app       = [string]$session.SourceAppUserModelId
            volume    = $vol
            muted     = [bool]$muted
            position  = [Math]::Round($posSec, 1)
            endTime   = [Math]::Round($endSec, 1)
            thumbnail = $thumbOut
        }
    } else {
        $script:lastThumbKey = ''
        $script:lastThumbLoaded = $false
        $obj = [ordered]@{
            ok        = $true
            found     = $false
            status    = 'Closed'
            title     = ''
            artist    = ''
            app       = ''
            volume    = $vol
            muted     = [bool]$muted
            position  = 0.0
            endTime   = 0.0
            thumbnail = $null
        }
    }
    [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
}

[void](Ensure-Manager)
Emit-Status

while ($null -ne ($line = [Console]::In.ReadLine())) {
    $cmd = $line.Trim().ToUpperInvariant()
    if ($cmd -eq 'POLL') {
        Emit-Status
    } elseif ($cmd -eq 'TOGGLE') {
        $s = Get-BraveSession
        if ($null -ne $s) {
            [void](Await ($s.TryTogglePlayPauseAsync()) ([bool]))
            Start-Sleep -Milliseconds 120
        }
        Emit-Status
    } elseif ($cmd -eq 'NEXT') {
        $s = Get-BraveSession
        if ($null -ne $s) {
            [void](Await ($s.TrySkipNextAsync()) ([bool]))
            Start-Sleep -Milliseconds 120
        }
        Emit-Status
    } elseif ($cmd -eq 'PREV') {
        $s = Get-BraveSession
        if ($null -ne $s) {
            [void](Await ($s.TrySkipPreviousAsync()) ([bool]))
            Start-Sleep -Milliseconds 120
        }
        Emit-Status
    } elseif ($cmd.StartsWith('VOL_DELTA:')) {
        $delta = 0
        if ([int]::TryParse($cmd.Substring(10), [ref]$delta)) {
            $m = $false
            [void][BraveAudioMixer]::AdjustVolume($delta, [ref]$m)
        }
        Emit-Status
    } elseif ($cmd -eq 'MUTE_TOGGLE') {
        $v = -1
        [void][BraveAudioMixer]::ToggleMute([ref]$v)
        Emit-Status
    } elseif ($cmd -eq 'QUIT') {
        break
    }
}
