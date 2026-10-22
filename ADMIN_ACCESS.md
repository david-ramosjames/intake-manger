# Admin Access Configuration

## Overview

This document explains how access control works in Intake Manager and how to grant admin access to users.

## Current Access Control

### Pages Requiring Admin Access

The following pages require admin privileges:

- `/sequences` - Call sequence configuration
- `/how-it-fits` - System architecture and integration details
- `/staff` - Staff directory management

### How Admin Access Works

Admin access is determined by the `isAdminEmail()` function in `src/lib/admin.ts`:

1. **Environment Variables** (checked first):
   - `ADMIN_EMAILS` - Comma-separated list of admin email addresses
   - `BOOTSTRAP_ADMIN_EMAIL` - Single admin email (for initial setup)

2. **Fallback** (if no environment variables are set):
   - `david@ramosjames.com` (hardcoded `FIRM_ADMIN`)

### Navigation Visibility

Admin-only pages only appear in the header navigation when the logged-in user has admin privileges. The links are in the `ADMIN_LINKS` constant in `src/components/AppHeader.tsx`.

## Granting Jon Access to the Sequences Page

To grant Jon access to the Sequences page, **add Jon's email to the `ADMIN_EMAILS` environment variable** in the Vercel deployment.

### Steps to Grant Access

1. Go to the Vercel dashboard for the `intake-manger` project
2. Navigate to Settings → Environment Variables
3. Find or create the `ADMIN_EMAILS` variable
4. Add Jon's email address to the comma-separated list

#### Example Configuration

```bash
# If Jon's email is jon@ramosjames.com:
ADMIN_EMAILS=david@ramosjames.com,jon@ramosjames.com

# Multiple admins can be added:
ADMIN_EMAILS=david@ramosjames.com,jon@ramosjames.com,another@ramosjames.com
```

5. Redeploy the application for changes to take effect

### Determining Jon's Email

Based on the codebase patterns:
- The allowed domain is `@ramosjames.com` (see `ALLOWED_DOMAIN` in `src/lib/supabase/config.ts`)
- Email format follows `firstname@ramosjames.com` pattern
- Examples: `david@ramosjames.com`, `jissela@ramosjames.com`

**Most likely**: `jon@ramosjames.com`

To verify Jon's exact email:
1. Check the Supabase Auth users table
2. Ask Jon which email he uses to sign in
3. Check the firm's staff directory or contact list

### Alternative: Bootstrap Admin (Not Recommended for Production)

The `BOOTSTRAP_ADMIN_EMAIL` variable can be used for single-admin setups, but `ADMIN_EMAILS` is preferred for production environments with multiple administrators.

## No Code Changes Required

This is a **configuration-only change**. No code modifications are needed. The access control system is already properly implemented.

## Security Notes

- Admin access grants full privileges including:
  - Viewing and modifying call sequences
  - Managing staff directory
  - Accessing system configuration details
- Only grant admin access to trusted staff members
- All admin actions require authentication via Supabase (Google sign-in)
- Admins must have an `@ramosjames.com` email address
