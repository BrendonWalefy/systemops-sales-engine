import { eq } from "drizzle-orm";
import type { Room } from "@/domain/entities/room";
import type { RoomRepository } from "@/domain/repositories/room-repository";
import { db } from "@/infrastructure/db/client";
import { rooms } from "@/infrastructure/db/schema";

export class DrizzleRoomRepository implements RoomRepository {
  async listByClinic(clinicId: string): Promise<Room[]> {
    const rows = await db.query.rooms.findMany({
      where: eq(rooms.clinicId, clinicId),
      orderBy: rooms.name,
    });
    return rows.map(mapRow);
  }

  async findById(id: string): Promise<Room | null> {
    const row = await db.query.rooms.findFirst({
      where: eq(rooms.id, id),
    });
    return row ? mapRow(row) : null;
  }

  async create(data: Omit<Room, "id" | "createdAt" | "updatedAt">): Promise<Room> {
    const [row] = await db
      .insert(rooms)
      .values({
        clinicId: data.clinicId,
        name: data.name,
        capacity: data.capacity,
        isActive: data.isActive,
      })
      .returning();
    return mapRow(row);
  }

  async update(
    id: string,
    data: Partial<Pick<Room, "name" | "capacity" | "isActive">>,
  ): Promise<Room> {
    const [row] = await db
      .update(rooms)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(rooms.id, id))
      .returning();
    return mapRow(row);
  }

  async delete(id: string): Promise<void> {
    await db.delete(rooms).where(eq(rooms.id, id));
  }
}

function mapRow(row: typeof rooms.$inferSelect): Room {
  return {
    id: row.id,
    clinicId: row.clinicId,
    name: row.name,
    capacity: row.capacity,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
