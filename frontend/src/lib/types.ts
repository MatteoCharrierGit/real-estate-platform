// Tipi degli oggetti del contratto (deploy/contratto.md). ID sempre stringhe, date ISO 8601.

export type ListingType = 'sale' | 'rent';

export interface Property {
  id: string;
  title: string;
  description: string;
  price: number;
  city: string;
  address: string;
  listingType: ListingType;
  rooms: number;
  bathrooms: number;
  areaSqm: number;
  status: 'active' | 'withdrawn';
  /** Assente se l'immobile e' ritirato. */
  ownerId?: string;
  coverKey: string | null;
  createdAt: string;
}

export interface User {
  sub: string;
  displayName: string | null;
  phone: string | null;
  bio: string | null;
  createdAt: string;
}

export interface PublicUser {
  sub: string;
  displayName: string | null;
  bio: string | null;
}

export type OfferStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn';

export interface Offer {
  id: string;
  propertyId: string;
  propertyTitle: string;
  buyerId: string;
  amount: number;
  message: string | null;
  status: OfferStatus;
  createdAt: string;
  updatedAt: string;
  role: 'buyer' | 'owner';
}

export interface FileItem {
  id: string;
  propertyId: string;
  key: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface PropertyInput {
  title: string;
  description: string;
  price: number;
  city: string;
  address: string;
  listingType: ListingType;
  rooms: number;
  bathrooms: number;
  areaSqm: number;
}

export interface PropertyFilters {
  city?: string;
  listingType?: ListingType;
  minPrice?: number;
  maxPrice?: number;
  rooms?: number;
  limit?: number;
  offset?: number;
}

export interface PresignedPost {
  url: string;
  fields: Record<string, string>;
  key: string;
  expiresIn: number;
}
