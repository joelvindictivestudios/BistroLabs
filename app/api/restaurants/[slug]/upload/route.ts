import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { getUser, getAdminSupabase } from "@/lib/auth/server";

const BUCKET = "restaurant-images";
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

let bucketReady = false;

/** Skapa bucketen vid första uppladdningen — MCP når inte detta externa projekt. */
async function ensureBucket() {
  if (bucketReady) return;
  const admin = getAdminSupabase();
  const { error } = await admin.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: MAX_BYTES,
    allowedMimeTypes: Object.keys(ALLOWED),
  });
  // "already exists" är förväntat från andra anropet och framåt
  if (error && !/already exists/i.test(error.message)) {
    throw new Error(`Kunde inte skapa bucket: ${error.message}`);
  }
  bucketReady = true;
}

// POST /api/restaurants/{slug}/upload — multipart FormData med fältet "file".
// Returnerar publik URL som läggs i restaurangens config (hero/sittningskort).
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/restaurants/[slug]/upload">,
) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Inte inloggad." }, { status: 401 });
  }

  const { slug } = await ctx.params;
  const restaurant = await prisma.restaurant.findUnique({ where: { slug } });
  if (!restaurant) {
    return NextResponse.json({ error: "Okänd restaurang." }, { status: 404 });
  }
  if (restaurant.ownerId !== user.id) {
    return NextResponse.json(
      { error: "Du äger inte den här restaurangen." },
      { status: 403 },
    );
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Skicka bilden som multipart-fältet \"file\"." },
      { status: 400 },
    );
  }
  const ext = ALLOWED[file.type];
  if (!ext) {
    return NextResponse.json(
      { error: "Endast JPEG, PNG eller WebP." },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Max 5 MB per bild." },
      { status: 400 },
    );
  }

  await ensureBucket();
  const admin = getAdminSupabase();
  const path = `${restaurant.id}/${crypto.randomUUID()}.${ext}`;
  const { error } = await admin.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type });
  if (error) {
    return NextResponse.json(
      { error: `Uppladdningen misslyckades: ${error.message}` },
      { status: 500 },
    );
  }

  const { data } = admin.storage.from(BUCKET).getPublicUrl(path);
  return NextResponse.json({ url: data.publicUrl }, { status: 201 });
}
