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

// Make React hooks globally available for all component files
const { useState, useEffect, useCallback, useRef } = React;
