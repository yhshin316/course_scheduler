# Margin

A React and Vite application for entering course information, managing teacher profiles, and viewing employee and course lists.

## Run locally

```sh
npm install
npm run dev
```

## Build and lint

```sh
npm run build
npm run lint
```

## Pages

- Home
- Course input and course input list
- Teacher profile and employee profile list
- Login and registration previews

Login and registration are visual previews only. Authentication and profile/course API requests need a configured backend.

## Backend configuration

Update `BACKEND_URL` in `src/services/apiService.js` to point to the backend. Until configured, course entries and profile edits use browser local storage where available.
