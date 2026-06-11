# SoakUp mobile app deployment roadmap (iOS + Android)

This document outlines a practical path to ship the current SoakUp web app as installable mobile apps for both Android and iOS.

## 1) Current state

SoakUp is a Vite + React + TypeScript web app with an Express server used during development/deployment for API proxying and caching.

## 2) Recommended approach

Use **Capacitor** to wrap the existing web app for native deployment:

- Reuses the current React codebase
- Supports Android and iOS from one project
- Allows gradual adoption of native plugins (location, notifications, etc.)

## 3) Roadmap

### Phase 0 — Mobile readiness in the web app

- [ ] Confirm responsive layout for common phone sizes
- [ ] Validate touch interactions on map controls
- [ ] Ensure API URLs/config are environment-driven for production mobile builds
- [ ] Verify app icons, splash assets, and manifest metadata are production-ready

### Phase 1 — Add Capacitor shell

- [ ] Install Capacitor in this project
- [ ] Initialize app id/name (for example: `com.soakup.app`, `SoakUp`)
- [ ] Set Capacitor `webDir` to Vite build output (`dist`)
- [ ] Add Android and iOS native projects

### Phase 2 — Native platform setup

#### Android

- [ ] Configure package id, app name, icons, splash
- [ ] Set network security settings (HTTPS APIs, cleartext disabled unless required)
- [ ] Request runtime permissions only when needed (location)
- [ ] Build release AAB/APK and test on physical devices

#### iOS

- [ ] Configure bundle id, signing team, app capabilities
- [ ] Add required privacy descriptions (`NSLocationWhenInUseUsageDescription`, etc.)
- [ ] Validate map/location behavior on device
- [ ] Build archive in Xcode and prepare App Store submission

### Phase 3 — Production hardening

- [ ] Add error reporting/crash tracking
- [ ] Add analytics/events needed for product feedback
- [ ] Verify offline/loading/error states on unstable mobile networks
- [ ] Confirm API rate limiting and caching behavior for mobile traffic

### Phase 4 — Store release workflow

- [ ] Create Google Play Console and App Store Connect listings
- [ ] Prepare store assets (screenshots, descriptions, privacy policy URL)
- [ ] Configure versioning/release notes process
- [ ] Run internal/beta testing tracks before public release

## 4) CI/CD roadmap (after first manual release)

- [ ] Automate `npm ci`, `npm run build`, and Capacitor sync in CI
- [ ] Add Android release pipeline (signed artifact generation)
- [ ] Add iOS release pipeline (or documented manual notarized flow from Xcode Cloud/Fastlane)
- [ ] Require smoke checks on map load + pub search flows before release promotion

## 5) Definition of done

The mobile roadmap is complete when:

- Android and iOS apps are installable from internal test channels
- Core user flow (open map → find pubs → navigate externally) works on device
- One production release has been successfully submitted to both stores
