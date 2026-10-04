$output = "Here is the current codebase for my project:`n`n"

$output += "=== DIRECTORY STRUCTURE ===`n"
$output += "sandbox/`n"
$output += "  ├── backend/`n"
$output += "  │   ├── api.py`n"
$output += "  │   ├── engine.py`n"
$output += "  │   └── data/ (contains SPICE kernels & ldem_4.img)`n"
$output += "  └── frontend/`n"
$output += "      └── src/`n"
$output += "          ├── App.jsx`n"
$output += "          └── index.css & App.css (both are empty)`n`n"

$files = @("backend\api.py", "backend\engine.py", "frontend\src\App.jsx")

foreach ($file in $files) {
    if (Test-Path $file) {
        $output += "=== FILE: $file ===`n```python`n"
        if ($file -match ".jsx$") { $output = $output.Replace("```python", "```jsx") }
        $output += (Get-Content $file -Raw)
        $output += "`n````n`n"
    }
}

$output | Set-Clipboard
Write-Host "✅ Project code successfully copied to your clipboard!" -ForegroundColor Green