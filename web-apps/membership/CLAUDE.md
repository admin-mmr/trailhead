# Claude Development Notes

## Important: dist/ is for deployment only

**DO NOT edit files in the `dist/` directory directly.** The `dist/` folder contains built/compiled files intended for deployment.

All code changes should be made in the `frontend/` and `src/` directories. The `dist/` folder is generated from these source files (typically through a build process) and any manual changes will be overwritten during the next build.

### Workflow:
1. Edit source files in `frontend/` or `src/`
2. Run the build process to update `dist/`
3. Deploy from `dist/`

This ensures consistency between source code and deployed code.
