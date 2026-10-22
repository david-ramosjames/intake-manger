# Case Type Standardization Migration

## Overview

This migration standardizes all case types to use the "T:" prefix format and removes deprecated types.

## What This Migration Does

1. **Adds `source_category` column** to leads table
2. **Standardizes all case types** to new T: format:
   - `Auto Accident` → `T: TBD`
   - `Commercial / 18 Wheeler` → `T: Commercial / 18 Wheeler`
   - `Dog Bite` → `T: Dog Bite`
   - `MedMal` → `T: TBD`
   - `Workers Comp` → `T: TBD`
   - `No Injuries / Property Damage` → `T: TBD`
   - And all other types...

## How to Run

### Option 1: Using the Shell Script (Recommended)

```bash
# Make sure you have .env.local with your Supabase credentials
./scripts/run-case-type-migration.sh
```

### Option 2: Using Supabase Dashboard

1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Open and run `supabase/migrations/20261022180000_source_category.sql`
4. Then run `supabase/migrations/20261022181000_standardize_case_types.sql`

### Option 3: Using Supabase CLI

```bash
# If you have Supabase CLI installed
supabase db push
```

### Option 4: Manual SQL Execution

Connect to your database using psql or any PostgreSQL client and execute:

```bash
psql $DATABASE_URL -f supabase/migrations/20261022180000_source_category.sql
psql $DATABASE_URL -f supabase/migrations/20261022181000_standardize_case_types.sql
```

## Verification

After running the migration, verify the changes:

```sql
-- Check distribution of new case types
SELECT case_type, count(*) as count
FROM public.leads
WHERE case_type LIKE 'T:%'
GROUP BY case_type
ORDER BY count DESC;

-- Check for any unmigrated case types
SELECT case_type, count(*) as count
FROM public.leads
WHERE case_type IS NOT NULL
  AND case_type NOT LIKE 'T:%'
GROUP BY case_type;
```

All case types should now have the "T:" prefix!

## Rollback (If Needed)

If you need to rollback, you can restore from a backup or run this SQL:

```sql
-- Remove the T: prefix (NOT RECOMMENDED - only for emergencies)
UPDATE public.leads
SET case_type = REPLACE(case_type, 'T: ', '')
WHERE case_type LIKE 'T:%';
```

## Support

If you encounter any issues:
1. Check that your Supabase credentials are correct in `.env.local`
2. Ensure you have service role key permissions
3. Review the migration SQL files for any syntax errors
4. Check the Supabase dashboard logs for error details
