import type { Room } from "../entities/room";

export type RoomRepository = {
  listByClinic(clinicId: string): Promise<Room[]>;
  findById(id: string): Promise<Room | null>;
  create(data: Omit<Room, "id" | "createdAt" | "updatedAt">): Promise<Room>;
  update(id: string, data: Partial<Pick<Room, "name" | "capacity" | "isActive">>): Promise<Room>;
  delete(id: string): Promise<void>;
};
