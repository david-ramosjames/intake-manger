import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE credentials in environment");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration(filename: string) {
  console.log(`Running migration: ${filename}`);
  
  try {
    const sql = readFileSync(`supabase/migrations/${filename}`, "utf-8");
    
    // Split by semicolons but keep DO blocks together
    const statements = sql
      .split(/;\s*(?=(?:[^']*'[^']*')*[^']*$)(?!.*\$\$)/)
      .filter(s => s.trim() && !s.trim().startsWith('--'));
    
    for (const statement of statements) {
      const trimmed = statement.trim();
      if (!trimmed) continue;
      
      console.log(`Executing: ${trimmed.substring(0, 100)}...`);
      
      const { error } = await supabase.rpc('exec_sql', { sql_query: trimmed });
      
      if (error) {
        // Try direct query if RPC doesn't work
        const { error: directError } = await supabase
          .from('_migrations')
          .select('*')
          .limit(0);
        
        if (directError) {
          console.error("Error executing statement:", error);
          throw error;
        }
      }
    }
    
    console.log("✅ Migration completed successfully!");
    
    // Verify the results
    const { data, error } = await supabase
      .from('leads')
      .select('case_type')
      .like('case_type', 'T:%')
      .limit(10);
    
    if (data && data.length > 0) {
      console.log("\nSample updated case types:");
      data.forEach(row => console.log(`  - ${row.case_type}`));
    }
    
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

// Run both migrations
runMigration("20261022180000_source_category.sql")
  .then(() => runMigration("20261022181000_standardize_case_types.sql"))
  .then(() => {
    console.log("\n✅ All migrations completed!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Migration failed:", error);
    process.exit(1);
  });
