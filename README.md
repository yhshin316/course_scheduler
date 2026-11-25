# ScheduleSpark frontend

The ScheduleSpark frontend is a React 19 single-page application built with Vite. It provides the Planning Workspace, Schedule Builder, Conflict Review, and Saved Drafts workflows.

## Requirements

- Node.js 20.19+ (or a current Node.js release supported by Vite 8)
- npm
- The ScheduleSpark API and MongoDB for live scheduling data (see the [backend guide](../ScheduleSpark/ScheduleSpark.Api/README.md))

## Run locally

From this directory (`course_scheduler`):

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite, usually `http://localhost:5173`.

### Point the frontend at the API

Vite reads `VITE_API_BASE_URL` when it starts. Create or edit `course_scheduler/.env.local` and set the base URL for the API you started:

```dotenv
VITE_API_BASE_URL=http://localhost:8080
```

Use `http://localhost:8080` when the API is running with Docker Compose or when you start it on port 8080. The default .NET launch profile uses `http://localhost:52142` and `https://localhost:52141`; for that profile, set the variable to one of those URLs. Restart Vite after changing `.env.local`.

`.env.local` is for machine-specific configuration. Do not commit credentials or private deployment URLs in it.

## Frontend commands

```sh
npm run dev       # Start Vite's development server
npm run build     # Create the production bundle in dist/
npm run preview   # Serve the production bundle locally after building
npm run lint      # Run Oxlint
```

The development server proxies no API requests; the frontend calls `VITE_API_BASE_URL` directly. The API currently allows cross-origin requests for local development.

## Main workflows

- **Planning Workspace:** choose a semester and offerings, review instructors, rooms, scheduling constraints and approved scheduling blocks, and import scheduling data.
- **Schedule Builder:** generate a draft from selected offering IDs, review the weekly schedule, filter it, edit assignments, and export or print it.
- **Conflict Review:** validate a draft, inspect affected assignments and suggested quick fixes, and open assignment editing.
- **Saved Drafts:** open, duplicate, delete, compare, and review versions of saved drafts.
- **Instructor workload and utilization:** review instructor course loads and schedule balance from the planning and schedule views.

Section navigation is client-side; moving between sections does not reload the app. The current section is stored in the URL hash so browser back and forward work for the workspace sections.

## Scheduling data and first run

On an empty MongoDB database, the API seeds example Fall 2026 offerings, instructors, rooms, and default scheduling constraints. Approved university scheduling blocks are configured separately in the Planning Workspace under **University Blocks**. Configure and save blocks for the selected semester before setting instructor availability or generating a schedule.

For spreadsheet imports, use the sample CSV downloads in **Planning Workspace → Import Data**. Excel imports should use sheets named `Courses`, `Instructors`, `Rooms`, `InstructorAvailability`, and `RoomAvailability`. Preview and resolve validation errors before confirming the import.

## Production deployment

The frontend Dockerfile builds the Vite app and serves its static files with Nginx on port 8080. Build and run it from this directory:

```sh
docker build -t schedulespark-frontend .
docker run --rm -p 8081:8080 schedulespark-frontend
```

The API address is compiled into the Vite bundle at build time. The current frontend Dockerfile does not expose a build argument or runtime API URL override, so its bundle uses the code default (`http://localhost:8080`) unless the Docker build is adjusted to inject `VITE_API_BASE_URL`. A `docker run -e VITE_API_BASE_URL=...` setting alone will not change an already-built bundle. Do not put secrets in frontend environment variables; values shipped to a browser are public.

## Troubleshooting

- **API not connected:** check that MongoDB and the API are running, then check `VITE_API_BASE_URL` and restart Vite.
- **HTTPS certificate warning:** when using the .NET HTTPS launch URL locally, trust the ASP.NET Core development certificate or use its HTTP launch URL instead.
- **No schedule blocks or availability save errors:** configure and enable approved blocks for the semester in **University Blocks** first.
- **No drafts appear:** drafts are stored in MongoDB; confirm the frontend and API use the same running backend/database.
