// A hard time limit for headless scripts: if the whole run takes longer than `seconds`, it prints why,
// closes the browser and exits with code 2. Nothing a test does can then hang for hours.
// Usage: const dog = watchdog(180, 'smoke'); ... dog.browser = browser; ... (it never keeps node alive by itself)
export function watchdog(seconds, name) {
  const dog = { browser: null };
  const t = setTimeout(async () => {
    console.log(`  FAIL ${name}: took longer than ${seconds} s, stopped (something is stuck)`);
    await Promise.race([dog.browser?.close(), new Promise((r) => setTimeout(r, 3000))]).catch(() => {});
    process.exit(2);
  }, seconds * 1000);
  t.unref();
  return dog;
}
