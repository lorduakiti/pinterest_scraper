# Configuração do NodeJS
node -v
npm init -y
npm i puppeteer-core
npm i playwright-core
node -e "require('puppeteer-core'); require('playwright-core'); console.log('ok')"
node _pinterest_scraper_image_like.js --help
node _pinterest_scraper_image_like_pw.js --help

# Caminho padrão da instalação do Google Chrome:
# C:\Program Files\Google\Chrome\Application\chrome.exe
# $env:CHROME_PATH="D:\Apps\Chrome\chrome.exe"