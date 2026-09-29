# Create the always-free e2-micro from Windows after `gcloud auth login`.
$ErrorActionPreference = "Stop"

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
  Write-Error "gcloud is not installed. Use Google Cloud Shell instead (see DEPLOY.md), or install: winget install Google.CloudSDK"
}

$Project = gcloud config get-value project 2>$null
if (-not $Project -or $Project -eq "(unset)") {
  Write-Error "Run: gcloud config set project YOUR_PROJECT_ID"
}

$Zone = if ($env:ZONE) { $env:ZONE } else { "us-central1-a" }
$Name = if ($env:NAME) { $env:NAME } else { "paper-vm" }
$Firewall = "allow-paper-3000"
$Root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path "$PSScriptRoot\startup.sh")) {
  $Root = Get-Location
}

Write-Host "Project=$Project Zone=$Zone Instance=$Name"

gcloud services enable compute.googleapis.com --project $Project

$exists = gcloud compute firewall-rules describe $Firewall --project $Project 2>$null
if (-not $exists) {
  gcloud compute firewall-rules create $Firewall `
    --project $Project `
    --allow=tcp:3000 `
    --target-tags=paper-http `
    --source-ranges=0.0.0.0/0 `
    --description="Paper app HTTP"
}

$vm = gcloud compute instances describe $Name --project $Project --zone $Zone 2>$null
if (-not $vm) {
  gcloud compute instances create $Name `
    --project $Project `
    --zone $Zone `
    --machine-type=e2-micro `
    --image-family=ubuntu-2204-lts `
    --image-project=ubuntu-os-cloud `
    --boot-disk-size=30GB `
    --boot-disk-type=pd-standard `
    --tags=paper-http `
    --metadata-from-file="startup-script=$PSScriptRoot\startup.sh"
}

$ip = gcloud compute instances describe $Name --project $Project --zone $Zone --format="get(networkInterfaces[0].accessConfigs[0].natIP)"
Write-Host "VM IP: $ip"
Write-Host "SSH: gcloud compute ssh $Name --zone $Zone"
Write-Host "Then on the VM: sudo bash /path/to/setup-app.sh (clone the repo first)"
Write-Host "App URL: http://${ip}:3000"
