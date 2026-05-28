import { createClient } from "@supabase/supabase-js";

const TARGET_URL = "https://bbnmxwpacdfqvicybhau.supabase.co";
const TARGET_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJibm14d3BhY2RmcXZpY3liaGF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0NDA3NDYsImV4cCI6MjA5MTAxNjc0Nn0.cGqnmu5BeaXosxoE-IEmjX-dF4zDYipzpYb5hhc8S6I";
const target = createClient(TARGET_URL, TARGET_ANON_KEY);

async function run() {
  // Querying information_schema to find existing tables
  const { data, error } = await target.rpc("get_tables_list"); // if exists, or try directly:
  if (error) {
    // try fallback direct query to custom table or postgres schemas
    const { data: data2, error: err2 } = await target.from("accounts").select("id").limit(1);
    console.log("accounts table read error:", err2?.message, "data:", data2);
    
    const { data: data3, error: err3 } = await target.from("managed_users").select("id").limit(1);
    console.log("managed_users table read error:", err3?.message, "data:", data3);
  } else {
    console.log("Tables list:", data);
  }
}
run();
