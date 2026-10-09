const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium}=require('playwright-core');
const {reportHtml,reportBody}=require('../lib/report-export');

test('A forty-check report prints only findings in a few A4 pages, not one mostly empty page per check', {skip:process.platform!=='win32',timeout:30000},async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const page=await browser.newPage();
    const audit={url:'https://example.ru/',checkedAt:'2026-10-09T10:00:00Z',scope:'Тестовый отчёт для проверки печатной вёрстки.',summary:{},checks:Array.from({length:40},(_,i)=>({
      id:'check-'+i,group:i%2?'seo':'legal',status:i<26?'passed':i<36?'failed':'review',title:(i<26?'PASSED CHECK ':'Тестовый пункт ')+i,
      evidence:'Описание результата проверки. Этот текст нужен для проверки длины строк и распределения текста по печатным страницам.',
      fix:'Рекомендация по исправлению с сохранением доказательств.',
      locations:i===26?Array.from({length:40},(_,n)=>({url:'https://example.ru/section/page-'+n,forms:[1,2]})):[]
    }))};
    await page.setContent(reportHtml(audit),{waitUntil:'load'});
    assert.equal(await page.locator('article').count(),14);
    const pdf=await page.pdf({format:'A4',preferCSSPageSize:true,printBackground:true});
    const pages=(pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length;
    assert.ok(pages>=2&&pages<=7,'Unexpected PDF page count: '+pages);
    if(process.env.REPORT_LAYOUT_QA==='1'){
      const folder=path.resolve(__dirname,'../.cache');
      await fs.mkdir(folder,{recursive:true});
      await fs.writeFile(path.join(folder,'compact-report-qa.pdf'),pdf);
      console.log('Compact print QA: '+pages+' A4 pages, 14 findings, 26 successful checks omitted');
    }
    const styles=await fs.readFile(path.resolve(__dirname,'../public/styles.css'),'utf8');
    await page.setContent(`<html><head><style>${styles}</style></head><body><main class="site">Application content</main><section class="print-report">${reportBody(audit)}</section></body></html>`);
    const appPdf=await page.pdf({format:'A4',printBackground:true});
    const appPages=(appPdf.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length;
    assert.ok(appPages>=2&&appPages<=7,'Unexpected in-app print page count: '+appPages);
  } finally {await browser.close();}
});
