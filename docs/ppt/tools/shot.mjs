import { chromium } from 'playwright';
const OUT = '/tmp/pptbuild/shots';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
await page.goto('http://127.0.0.1:8020/docs/ppt/index.html', { waitUntil: 'networkidle' });
await page.evaluate(() => { document.getElementById('nav')?.remove(); document.body.classList.add('motion-ready'); });
await page.waitForTimeout(1500);
const total = await page.evaluate(() => document.querySelectorAll('section.slide').length);
for (let i = 0; i < total; i++) {
  await page.evaluate((i) => {
    const deck = document.querySelector('.deck') || document.body;
    const slides = document.querySelectorAll('section.slide');
    const el = slides[i];
    deck.style.transform = `translateX(${-i * 100}vw)`;
    window.__currentSlideIndex = i;
    document.body.classList.toggle('dark-bg', el.classList.contains('dark') || el.classList.contains('accent'));
    document.body.classList.toggle('accent-bg', el.classList.contains('accent'));
    document.querySelectorAll('#nav .dot').forEach((d, k) => d.classList.toggle('active', k === i));
    if (window.__playSlide) window.__playSlide(i);
  }, i);
  await page.waitForTimeout(1600);
  const id = await page.evaluate(() => document.querySelectorAll('section.slide')[window.__currentSlideIndex].dataset.slideId);
  await page.screenshot({ path: `${OUT}/${String(i + 1).padStart(2, '0')}-${id}.png` });
  console.log(`shot ${i + 1}/${total} ${id}`);
}
await browser.close();
