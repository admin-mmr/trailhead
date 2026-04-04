/**
 * Component Loader — Eliminates repetitive boilerplate in external component files
 *
 * Usage in external component files:
 *   <script type="text/babel">
 *     initComponent('ComponentName', () => {
 *       const [state, setState] = useState(...);
 *       return <div>...</div>;
 *     });
 *   </script>
 */

const initComponent = (componentName, componentFn) => {
  window[componentName] = componentFn;
};

// Note: React hooks are already declared globally in index.html
// No need to redeclare them here — this avoids "Identifier has already been declared" errors
