import type { Metadata } from "next";
import { LanguageProvider } from "@/components/language-provider";
import { effectiveLanguage, languageHtmlTag } from "@/lib/language-core";
import { getRequestLanguagePreferences } from "@/lib/language-server";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const preferences = await getRequestLanguagePreferences();
  return effectiveLanguage(preferences, "common") === "en"
    ? { title: "Debate Suite", description: "A local-first debate workspace." }
    : { title: "美辩", description: "本地优先的辩论工作台。" };
}
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const preferences = await getRequestLanguagePreferences();
  return (
    <html lang={languageHtmlTag(preferences.globalMode)}>
      <body>
        <LanguageProvider initialPreferences={preferences}>{children}</LanguageProvider>
      </body>
    </html>
  );
}
