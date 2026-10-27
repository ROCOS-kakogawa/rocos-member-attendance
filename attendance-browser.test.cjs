const {chromium}=require('C:/Users/Owner/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const context=await browser.newContext();
    await context.route('https://**/*',route=>route.fulfill({status:504,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{"message":"Gateway Timeout"}'}));
    await context.addInitScript(() => {
      if (!localStorage.getItem('rocos-member-attendance-cache')) localStorage.setItem('rocos-member-attendance-cache', JSON.stringify({ users: [{id:'test-one',name:'Test member'}], attendance:{}, settings:{hourlyRate:320}, taskRates:{daily:[],weekly:[],monthly:[],piece:[]} }));
    });
    const page=await context.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const base=pathToFileURL(path.join(__dirname,'index.html')).href+'?input=1';
    await page.goto(base);
    await page.waitForFunction(()=>document.querySelector('#punchUser').options.length>0,{},{timeout:3000});
    assert.doesNotMatch(await page.locator('#punchStatus').innerText(),/読み込み中/);
    await page.locator('[data-page="edit"]').click();
    await page.locator('#editDate').fill('2099-01-05');
    await page.locator('#editDate').dispatchEvent('change');
    await page.locator('#editStatus').selectOption('出勤');
    await page.locator('#editStart').fill('09:00');
    await page.locator('#editMemo').fill('browser-offline-test');
    await page.locator('#saveEditButton').click();
    await page.waitForFunction(()=>document.querySelector('#syncStatus').textContent.includes('端末に保存済み'));
    await page.reload();
    await page.waitForFunction(()=>document.querySelector('#punchUser').options.length>0);
    await page.locator('[data-page="edit"]').click();
    await page.locator('#editDate').fill('2099-01-05');
    await page.locator('#editDate').dispatchEvent('change');
    assert.equal(await page.locator('#editMemo').inputValue(),'browser-offline-test');
    console.log('PASS: punch page loads immediately during 504; corrected record survives reload');
    await page.goto(pathToFileURL(path.join(__dirname,'pc.html')).href);
    await page.waitForFunction(()=>document.querySelector('#hourlyRateInput').value!=='',{},{timeout:3000});
    await page.locator('#hourlyRateInput').fill('333');
    await page.locator('#hourlyRateInput').dispatchEvent('change');
    await page.waitForFunction(()=>localStorage.getItem('rocos-member-attendance-admin-pending-v1'));
    await page.reload();
    await page.waitForFunction(()=>document.querySelector('#hourlyRateInput').value==='333',{},{timeout:3000});
    console.log('PASS: admin loads immediately during 504; local edit survives reload and remains pending');
    assert.deepEqual(errors,[],'no uncaught page errors');
    await context.close();
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
