# 建立 Windows 排程工作：每天「泰國時間 17:10」執行打卡同步。
# 會自動換算成這台電腦的當地時間（例如台北 +8 會是 18:10），並勾選「錯過排定時間就儘快執行」。
# 由 install-windows-task.bat 呼叫；這個檔案要存成 UTF-8 含 BOM，Windows PowerShell 5.1 才讀得懂中文。
$ErrorActionPreference = 'Stop'
$taskName = '校務系統打卡同步'
$thaiHour = 17
$thaiMinute = 10

try {
  $thaiTz = [TimeZoneInfo]::FindSystemTimeZoneById('SE Asia Standard Time')
  $thaiTime = [DateTime]::SpecifyKind([DateTime]::Today.AddHours($thaiHour).AddMinutes($thaiMinute), 'Unspecified')
  $localTime = [TimeZoneInfo]::ConvertTime($thaiTime, $thaiTz, [TimeZoneInfo]::Local)

  $bat = Join-Path $PSScriptRoot 'run-sync.bat'
  $action = New-ScheduledTaskAction -Execute $bat -Argument '--scheduled' -WorkingDirectory $PSScriptRoot
  $trigger = New-ScheduledTaskTrigger -Daily -At $localTime
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null

  Write-Host ''
  Write-Host ("已建立排程「{0}」：每天泰國時間 {1:D2}:{2:D2}（這台電腦的 {3}）自動同步。" -f $taskName, $thaiHour, $thaiMinute, $localTime.ToString('HH:mm'))
  Write-Host '錯過排定時間（例如電腦關機）會在開機後儘快補跑。結果請看 sync.log。'
} catch {
  Write-Host ''
  Write-Host ('建立失敗：' + $_.Exception.Message)
  Write-Host '請對 install-windows-task.bat 按右鍵 → 以系統管理員身分執行。'
  exit 1
}
