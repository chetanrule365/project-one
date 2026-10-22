import { redirect } from "react-router";
import type { Route } from "./+types/demo";
import { demoSetCookie } from "../lib/demo.server";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Demo · Project One" },
    {
      name: "description",
      content: "Sample walkthrough of the paper-trading lab",
    },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  throw redirect("/", {
    headers: { "Set-Cookie": demoSetCookie(request) },
  });
}
