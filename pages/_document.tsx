import { Html, Head, Main, NextScript } from 'next/document'

/**
 * Exists for one reason: to catch `beforeinstallprompt` before React hydrates.
 *
 * Chrome fires that event once, as soon as the page qualifies for install, and
 * it is the only way to show the real OS install dialog later. If nothing is
 * listening at that moment it is simply gone — and a component that registers
 * its listener in useEffect is racing hydration to get there, which on a slow
 * phone it can lose. Parking the event on window from an inline script in the
 * head means the listener is in place before anything else on the page runs;
 * InstallPrompt picks it up from there on mount.
 */
const CAPTURE_INSTALL_PROMPT = `
window.addEventListener('beforeinstallprompt', function (e) {
  e.preventDefault();
  window.__deferredInstallPrompt = e;
});
window.addEventListener('appinstalled', function () {
  window.__deferredInstallPrompt = null;
});
`

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <script dangerouslySetInnerHTML={{ __html: CAPTURE_INSTALL_PROMPT }} />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
