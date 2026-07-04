-- DropIndex
DROP INDEX "guest_interactions_embedding_idx";

-- DropIndex
DROP INDEX "knowledge_documents_embedding_idx";

-- AlterTable
ALTER TABLE "restaurants" ADD COLUMN     "owner_id" UUID;
