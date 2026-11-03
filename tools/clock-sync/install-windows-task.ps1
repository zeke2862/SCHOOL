# 建立 Windows 排程工作：每天泰國時間 17:00 與 20:00 各執行一次打卡同步（備援；平常由打卡機 ADMS 即時推送）。
# 會自動換算成這台電腦的當地時間（例如台北 +8 會是 18:10），並勾選「錯過排定時間就儘快執行」。
# 由 install-windows-task.bat 呼叫；這個檔案要存成 UTF-8 含 BOM，Windows PowerShell 5.1 才讀得懂中文。
$ErrorActionPreference = 'Stop'
$taskName = '校務系統打卡同步'
$thaiTimes = @(@(17, 0), @(20, 0))

try {
  $thaiTz = [TimeZoneInfo]::FindSystemTimeZoneById('SE Asia Standard Time')
  $localTimes = @()
  foreach ($t in $thaiTimes) {
    $thaiTime = [DateTime]::SpecifyKind([DateTime]::Today.AddHours($t[0]).AddMinutes($t[1]), 'Unspecified')
    $localTimes += [TimeZoneInfo]::ConvertTime($thaiTime, $thaiTz, [TimeZoneInfo]::Local)
  }

  $bat = Join-Path $PSScriptRoot 'run-sync.bat'
  $action = New-ScheduledTaskAction -Execute $bat -Argument '--scheduled' -WorkingDirectory $PSScriptRoot
  $trigger = @($localTimes | ForEach-Object { New-ScheduledTaskTrigger -Daily -At $_ })
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null

  Write-Host ''
  Write-Host ("已建立排程「{0}」：每天泰國時間 17:00 與 20:00（這台電腦的 {1}）各同步一次。" -f $taskName, (($localTimes | ForEach-Object { $_.ToString('HH:mm') }) -join '、'))
  Write-Host '錯過排定時間（例如電腦關機）會在開機後儘快補跑。結果請看 sync.log。'
} catch {
  Write-Host ''
  Write-Host ('建立失敗：' + $_.Exception.Message)
  Write-Host '請對 install-windows-task.bat 按右鍵 → 以系統管理員身分執行。'
  exit 1
}
