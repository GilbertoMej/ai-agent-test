Get-CimInstance Win32_Process | Where-Object {
  $_.Name -match '^(node|tsx|concurrently|pnpm)\.exe$'
} | Select-Object ProcessId, ParentProcessId, Name, CommandLine | Format-List
