import { defineConfig } from 'vite';

// Keep the release portable across a domain root and static subdirectories.
export default defineConfig({ base: './' });
