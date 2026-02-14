/**
 * Minimal application bootstrap. This previously contained prototype viewer wiring
 * but the new build no longer ships a default SliceViewer demo. Keep the DOM helper
 * here so downstream apps can import a predictable initialization routine.
 */

export async function initializeApp(): Promise<void> {
  const appContainer = document.getElementById('app-container');
  if (!appContainer) {
    console.warn('App container element #app-container not found. Skipping viewer init.');
    return;
  }

  appContainer.style.display = 'flex';
  appContainer.style.height = '100vh';
}

// Auto-run when the module is loaded in a browser context.
void initializeApp();
