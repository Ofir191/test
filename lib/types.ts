export type Role = "admin" | "dispatcher" | "patrol" | "authorized_user";
export type CallStatus = "new" | "received" | "en_route" | "arrived" | "closed";

export interface House {
  id: number;
  name: string;
  phone: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  areaId: number | null;
  notes: string | null;
  ownerUserId: number | null;
}

export interface CallEvent {
  id: number;
  status: string;
  actorId: number | null;
  actorName: string;
  note: string | null;
  lat: number | null;
  lng: number | null;
  createdAt: string;
}

export interface Call {
  id: number;
  houseId: number;
  status: CallStatus;
  statusLabel: string;
  openedBy: number;
  openerName: string;
  assignedPatrolId: number | null;
  assigneeName: string | null;
  notes: string | null;
  openedAt: string;
  receivedAt: string | null;
  enRouteAt: string | null;
  arrivedAt: string | null;
  closedAt: string | null;
  house: House | null;
  events: CallEvent[];
}

export interface Area {
  id: number;
  name: string;
  description: string | null;
  color: string;
  centerLat: number | null;
  centerLng: number | null;
  radiusMeters: number;
}

export interface Shift {
  id: number;
  name: string;
  areaId: number | null;
  startTime: string;
  endTime: string;
  days: number[];
  active: boolean;
}

export interface Patrol {
  id: number;
  fullName: string;
  phone: string | null;
  email?: string;
  accountActive: boolean;
  isActive: boolean;
  lat: number | null;
  lng: number | null;
  locationUpdatedAt: string | null;
  shiftId: number | null;
  onShift: boolean;
  areaIds: number[];
  shiftName: string | null;
}

export interface DirectoryUser {
  id: number;
  fullName: string;
  phone: string | null;
  email: string;
  role: Role;
  active: boolean;
  areaIds: number[];
  shiftId: number | null;
}

export interface PolygonGroup {
  id: number;
  name: string;
  confirmed: boolean;
  radiusMeters: number;
  createdAt: string;
  callIds: number[];
}

export interface Notice {
  id: number;
  callId: number | null;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

export interface OpsState {
  me: {
    id: number;
    email: string;
    fullName: string;
    phone: string | null;
    role: Role;
    isActive: boolean | null;
    onShift: boolean | null;
    shiftName: string | null;
    shiftId: number | null;
    areaIds: number[];
    lat: number | null;
    lng: number | null;
  };
  settings: { polygonRadiusMeters: number; gpsMatchMeters: number };
  areas: Area[];
  shifts: Shift[];
  houses: House[];
  calls: Call[];
  polygons: PolygonGroup[];
  patrols: Patrol[];
  users: DirectoryUser[];
  notifications: Notice[];
  serverTime: string;
}

export const ROLE_LABEL: Record<Role, string> = {
  admin: "מנהל מערכת",
  dispatcher: "מוקדן",
  patrol: "סייר",
  authorized_user: "משתמש מורשה",
};

export const STATUS_LABEL: Record<CallStatus, string> = {
  new: "נשלחה",
  received: "התקבלה",
  en_route: "בדרך",
  arrived: "הגיע",
  closed: "נסגרה",
};

export const NEXT_STATUS: Record<CallStatus, CallStatus[]> = {
  new: ["received", "en_route", "arrived", "closed"],
  received: ["en_route", "arrived", "closed"],
  en_route: ["arrived", "closed"],
  arrived: ["closed"],
  closed: [],
};

export function homeFor(role: Role) {
  if (role === "patrol") return "/patrol";
  if (role === "authorized_user") return "/portal";
  return "/dispatch";
}
