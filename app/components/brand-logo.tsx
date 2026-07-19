import Image from "next/image";
import whiteLogo from "@/public/BLWhiteSide.png";
import blackLogo from "@/public/BLBlackSide.png";

/**
 * BistroLabs-loggan: vit variant på mörka teman, svart på ljusa.
 * Båda renderas; tokens.css visar rätt via [data-theme="light"].
 *
 * Storleksmatchning: samma ordbild i båda filerna → matcha BREDDEN.
 * Vita (345×75 med inbyggd luft) blir 129 px bred vid h-7, varav ~126 px
 * är själva ordbilden; svarta är tight-trimmad och låses till w-[126px].
 * mt-px kompenserar för vita filens toppluft så höjdläget blir identiskt.
 */
export function BrandLogo() {
  return (
    <>
      <Image
        src={whiteLogo}
        alt="BistroLabs"
        className="h-7 w-auto logo-on-dark"
      />
      <Image
        src={blackLogo}
        alt="BistroLabs"
        className="mt-px h-auto w-[126px] logo-on-light hidden"
      />
    </>
  );
}
