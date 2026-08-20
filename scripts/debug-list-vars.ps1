Get-Content .env.local | Where-Object { $_ -match '^[A-Z_][A-Z0-9_]*=' } | ForEach-Object { ($_ -split '=',2)[0] }
