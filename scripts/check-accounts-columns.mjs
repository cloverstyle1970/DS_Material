import { createClient } from "@supabase/supabase-js";

const TARGET_URL = "https://bbnmxwpacdfqvicybhau.supabase.co";
const TARGET_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJibm14d3BhY2RmcXZpY3liaGF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0NDA3NDYsImV4cCI6MjA5MTAxNjc0Nn0.cGqnmu5BeaXosxoE-IEmjX-dF4zDYipzpYb5hhc8S6I";
const target = createClient(TARGET_URL, TARGET_ANON_KEY);

async function run() {
  const { data, error } = await target.from("accounts").select("*").limit(1);
  if (error) {
    console.error("Error fetching target accounts:", error.message);
  } else if (data && data.length > 0) {
    console.log("Target accounts columns:", Object.keys(data[0]));
    console.log("Sample accounts record:", data[0]);
  } else {
    // If table is empty, we can find column names by querying information_schema.columns via an rpc if it existed, or we can check the colleague's image or our scripts
    console.log("accounts table is empty or read returned no rows.");
  }
}
run();
