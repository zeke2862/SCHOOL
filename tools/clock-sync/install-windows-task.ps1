# 建立 Windows 排程工作：每天泰國時間 06:30 起，每 5 分鐘執行一次打卡同步，持續 14 小時（到 20:30），老師打卡後幾分鐘內就看得到。
# 會自動換算成這台電腦的當地時間（例如台北 +8 會是 18:10），並勾選「錯過排定時間就儘快執行」。
# 由 install-windows-task.bat 呼叫；這個檔案要存成 UTF-8 含 BOM，Windows PowerShell 5.1 才讀得懂中文。
$ErrorActionPreference = 'Stop'
$taskName = '校務系統打卡同步'
$thaiHour = 6
$thaiMinute = 30
$everyMinutes = 5
$forHours = 14

try {
  $thaiTz = [TimeZoneInfo]::FindSystemTimeZoneById('SE Asia Standard Time')
  $thaiTime = [DateTime]::SpecifyKind([DateTime]::Today.AddHours($thaiHour).AddMinutes($thaiMinute), 'Unspecified')
  $localTime = [TimeZoneInfo]::ConvertTime($thaiTime, $thaiTz, [TimeZoneInfo]::Local)

  $bat = Join-Path $PSScriptRoot 'run-sync.bat'
  $action = New-ScheduledTaskAction -Execute $bat -Argument '--scheduled' -WorkingDirectory $PSScriptRoot
  $trigger = New-ScheduledTaskTrigger -Daily -At $localTime
  $rep = (New-ScheduledTaskTrigger -Once -At $localTime -RepetitionInterval (New-TimeSpan -Minutes $everyMinutes) -RepetitionDuration (New-TimeSpan -Hours $forHours)).Repetition
  $trigger.Repetition = $rep
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 4) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null

  Write-Host ''
  Write-Host ("已建立排程「{0}」：每天泰國時間 {1:D2}:{2:D2} 起每 {4} 分鐘同步一次、持續 {5} 小時（這台電腦的 {3} 起）。" -f $taskName, $thaiHour, $thaiMinute, $localTime.ToString('HH:mm'), $everyMinutes, $forHours)
  Write-Host '錯過排定時間（例如電腦關機）會在開機後儘快補跑。結果請看 sync.log。'
} catch {
  Write-Host ''
  Write-Host ('建立失敗：' + $_.Exception.Message)
  Write-Host '請對 install-windows-task.bat 按右鍵 → 以系統管理員身分執行。'
  exit 1
}
