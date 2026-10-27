const {chromium,devices}=require('C:/Users/Owner/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  for(const desktopUA of [false,true]) {
   const context=await browser.newContext({...devices['iPad (gen 7)'],...(desktopUA?{userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15'}:{})});
   if(desktopUA)await context.addInitScript(()=>Object.defineProperty(navigator,'maxTouchPoints',{get:()=>5}));
   await context.route('https://**/*',route=>route.fulfill({status:504,body:'{}'}));
   const page=await context.newPage();
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(pathToFileURL(path.join(__dirname,'index.html')).href+'?input=1');
   assert.equal(await page.locator('.admin-link').isVisible(),false);
   await page.goto(pathToFileURL(path.join(__dirname,'pc.html')).href);
   await page.waitForURL(url => url.pathname.endsWith('/index.html'));
   assert.equal(await page.locator('.admin-link').isVisible(),false);
   assert.deepEqual(errors,[]);
   await context.close();
  }
  const desktop=await browser.newContext();
  await desktop.route('https://**/*',route=>route.fulfill({status:504,body:'{}'}));
  const page=await desktop.newPage();
  await page.goto(pathToFileURL(path.join(__dirname,'index.html')).href+'?input=1');
  assert.equal(await page.locator('.admin-link').isVisible(),true);
  await page.locator('.admin-link').click();
  await page.waitForURL('**/pc.html');
  assert.equal(await page.locator('#monthInput').isVisible(),true);
  await desktop.close();
  console.log('PASS: both iPad browser modes block management, direct access returns to input, desktop management remains available');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
