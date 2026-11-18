param([Parameter(Mandatory=$true)][string]$StateFile,[int]$ParentPid=0)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form=New-Object System.Windows.Forms.Form
$form.FormBorderStyle=[System.Windows.Forms.FormBorderStyle]::None
$form.ShowInTaskbar=$false
$form.TopMost=$true
$form.StartPosition=[System.Windows.Forms.FormStartPosition]::Manual
$form.Size=New-Object System.Drawing.Size(390,118)
$form.BackColor=[System.Drawing.Color]::FromArgb(5,8,10)
$form.Opacity=0.98

$shadow=New-Object System.Windows.Forms.Panel
$shadow.Location=New-Object System.Drawing.Point(7,8);$shadow.Size=New-Object System.Drawing.Size(378,104)
$shadow.BackColor=[System.Drawing.Color]::FromArgb(2,4,6);$form.Controls.Add($shadow)

$card=New-Object System.Windows.Forms.Panel
$card.Location=New-Object System.Drawing.Point(1,1);$card.Size=New-Object System.Drawing.Size(378,104)
$card.BackColor=[System.Drawing.Color]::FromArgb(23,31,38)
$form.Controls.Add($card);$card.BringToFront()

$accent=New-Object System.Windows.Forms.Panel
$accent.Location=New-Object System.Drawing.Point(0,0);$accent.Size=New-Object System.Drawing.Size(5,104)
$accent.BackColor=[System.Drawing.Color]::FromArgb(44,199,232);$card.Controls.Add($accent)

$iconBox=New-Object System.Windows.Forms.PictureBox
$iconBox.Location=New-Object System.Drawing.Point(20,25);$iconBox.Size=New-Object System.Drawing.Size(42,42)
$iconBox.SizeMode=[System.Windows.Forms.PictureBoxSizeMode]::Zoom
$iconBox.BackColor=[System.Drawing.Color]::Transparent
$card.Controls.Add($iconBox)
$volumeIcon=[System.Drawing.Image]::FromFile((Join-Path $PSScriptRoot '..\images\volume.png'))
$muteIcon=[System.Drawing.Image]::FromFile((Join-Path $PSScriptRoot '..\images\mute.png'))
$outputIcon=[System.Drawing.Image]::FromFile((Join-Path $PSScriptRoot '..\images\device.png'))
$inputIcon=[System.Drawing.Image]::FromFile((Join-Path $PSScriptRoot '..\images\micdevice.png'))
$iconBox.Image=$volumeIcon

$label=New-Object System.Windows.Forms.Label
$label.Location=New-Object System.Drawing.Point(80,18);$label.Size=New-Object System.Drawing.Size(202,26)
$label.ForeColor=[System.Drawing.Color]::FromArgb(244,247,249);$label.BackColor=[System.Drawing.Color]::Transparent
$label.Font=New-Object System.Drawing.Font('Segoe UI Semibold',13)
$card.Controls.Add($label)

$value=New-Object System.Windows.Forms.Label
$value.Location=New-Object System.Drawing.Point(281,20);$value.Size=New-Object System.Drawing.Size(78,23)
$value.TextAlign=[System.Drawing.ContentAlignment]::MiddleRight;$value.AutoEllipsis=$false
$value.BackColor=[System.Drawing.Color]::Transparent;$value.Font=New-Object System.Drawing.Font('Segoe UI Semibold',10)
$card.Controls.Add($value)

$sub=New-Object System.Windows.Forms.Label
$sub.Location=New-Object System.Drawing.Point(81,47);$sub.Size=New-Object System.Drawing.Size(278,20)
$sub.ForeColor=[System.Drawing.Color]::FromArgb(167,181,191);$sub.BackColor=[System.Drawing.Color]::Transparent
$sub.Font=New-Object System.Drawing.Font('Segoe UI',8.5)
$card.Controls.Add($sub)

$trackShell=New-Object System.Windows.Forms.Panel
$trackShell.Location=New-Object System.Drawing.Point(81,79);$trackShell.Size=New-Object System.Drawing.Size(278,7)
$trackShell.BackColor=[System.Drawing.Color]::FromArgb(11,16,20);$card.Controls.Add($trackShell)
$track=New-Object System.Windows.Forms.Panel
$track.Location=New-Object System.Drawing.Point(1,1);$track.Size=New-Object System.Drawing.Size(276,5)
$track.BackColor=[System.Drawing.Color]::FromArgb(60,73,82);$trackShell.Controls.Add($track)
$fill=New-Object System.Windows.Forms.Panel
$fill.Location=New-Object System.Drawing.Point(0,0);$fill.Height=5;$track.Controls.Add($fill)

$deviceLine=New-Object System.Windows.Forms.Panel
$deviceLine.Location=New-Object System.Drawing.Point(81,82);$deviceLine.Size=New-Object System.Drawing.Size(278,2)
$deviceLine.BackColor=[System.Drawing.Color]::FromArgb(82,218,153);$deviceLine.Visible=$false
$card.Controls.Add($deviceLine)

$area=[System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$script:visibleX=$area.Right-$form.Width-24
$script:hiddenX=$area.Right+8
$script:targetX=$script:hiddenX
$form.Location=New-Object System.Drawing.Point($script:hiddenX,($area.Top+24))
$form.Hide()
$script:lastId=[int64]0
$script:hideAt=[datetime]::MinValue
$script:mode='hidden'

function Update-Content($item){
 $label.Text=[string]$item.label;$sub.Text=[string]$item.subtitle
 if([string]$item.kind -eq 'device'){$value.Text='CHANGED';$value.ForeColor=[System.Drawing.Color]::FromArgb(82,218,153);$accent.BackColor=$value.ForeColor;$iconBox.Image=if(([string]$item.label)-like '*INPUT*'){$inputIcon}else{$outputIcon};$trackShell.Visible=$false;$track.Visible=$false;$deviceLine.Visible=$true;$fill.Width=0}
 elseif([bool]$item.muted){$trackShell.Visible=$true;$track.Visible=$true;$deviceLine.Visible=$false;$value.Text='MUTED';$value.ForeColor=[System.Drawing.Color]::FromArgb(255,105,119);$accent.BackColor=$value.ForeColor;$iconBox.Image=$muteIcon;$fill.BackColor=[System.Drawing.Color]::FromArgb(255,85,103);$fill.Width=0}
 else{$trackShell.Visible=$true;$track.Visible=$true;$deviceLine.Visible=$false;$n=[math]::Max(0,[math]::Min(100,[double]$item.value));$value.Text=([int]$n).ToString()+'%';$value.ForeColor=[System.Drawing.Color]::FromArgb(72,207,241);$accent.BackColor=[System.Drawing.Color]::FromArgb(44,199,232);$iconBox.Image=$volumeIcon;$fill.BackColor=[System.Drawing.Color]::FromArgb(44,199,232);$fill.Width=[int](2.76*$n)}
}

$timer=New-Object System.Windows.Forms.Timer
$timer.Interval=16
$timer.Add_Tick({
 if($ParentPid -gt 0 -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)){$timer.Stop();$form.Close();return}
 try{
  if(Test-Path -LiteralPath $StateFile){
   $item=Get-Content -LiteralPath $StateFile -Encoding utf8 -Raw|ConvertFrom-Json
   if([int64]$item.id -ne $script:lastId){
    $script:lastId=[int64]$item.id;Update-Content $item
    $area=[System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    $script:visibleX=$area.Right-$form.Width-24;$script:hiddenX=$area.Right+8
    if(-not $form.Visible){$form.Location=New-Object System.Drawing.Point($script:hiddenX,($area.Top+24));$form.Show()}
    $script:targetX=$script:visibleX;$script:mode='entering'
    $script:hideAt=(Get-Date).AddMilliseconds([math]::Max(500,[int]$item.duration))
   }
  }
 }catch{}
 if($form.Visible){
  if((Get-Date) -ge $script:hideAt -and $script:mode -ne 'leaving'){$script:targetX=$script:hiddenX;$script:mode='leaving'}
  $x=[double]$form.Left;$distance=$script:targetX-$x
  if([math]::Abs($distance) -gt 1){$step=[math]::Max(5,[math]::Abs($distance)*0.24);if($distance -lt 0){$step=-$step};$form.Left=[int]($x+$step)}
  else{$form.Left=[int]$script:targetX;if($script:mode -eq 'entering'){$script:mode='visible'}elseif($script:mode -eq 'leaving'){$script:mode='hidden';$form.Hide()}}
 }
})
$timer.Start()
[System.Windows.Forms.Application]::Run($form)
$timer.Dispose();$form.Dispose();$volumeIcon.Dispose();$muteIcon.Dispose();$outputIcon.Dispose();$inputIcon.Dispose()
