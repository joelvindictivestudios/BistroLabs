import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth/server";

export default async function Home() {
  redirect((await getUser()) ? "/create-restaurant" : "/login");
}
