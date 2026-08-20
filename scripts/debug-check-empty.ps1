Get-Content .env.local | Where-Object { $_ -match '^[A-Z_][A-Z0-9_]*=' } | ForEach-Object {
  $parts = $_ -split '=', 2
  $name = $parts[0]
  $value = $parts[1]
  $status = if ([string]::IsNullOrWhiteSpace($value)) { 'EMPTY' } else { 'set' }
  Write-Output ("{0,-28} {1} (len={2})" -f $name, $status, $value.Length)
}
