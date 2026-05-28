import { createClient } from "@supabase/supabase-js";

const TARGET_URL = "https://bbnmxwpacdfqvicybhau.supabase.co";
const TARGET_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJibm14d3BhY2RmcXZpY3liaGF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0NDA3NDYsImV4cCI6MjA5MTAxNjc0Nn0.cGqnmu5BeaXosxoE-IEmjX-dF4zDYipzpYb5hhc8S6I";
const target = createClient(TARGET_URL, TARGET_ANON_KEY);

async function run() {
  const { data, error } = await target.from("users").select("id, name, status, role").limit(10);
  if (error) {
    console.error("Error fetching target users:", error.message);
  } else {
    console.log("Target users (first 10):", data);
  }
}
run();
