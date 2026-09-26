export type User = {
  id: number;
  email: string;
  full_name: string;
  role: string;
  avatar_url?: string | null;
  google_subject?: string | null;
  google_email_verified?: boolean;
};

export type QuestionLibraryFile = {
  id: string;
  name: string;
  relative_path: string;
  mime_type: string;
  size?: number | null;
  year?: number | null;
  view_url?: string;
  modified_at?: string | null;
  is_question_file: boolean;
  is_answer_key: boolean;
};

export type QuestionLibrary = {
  premium_required?: boolean;
  library_access?: boolean;
  folder_id: string;
  folder_url?: string;
  file_count: number;
  years: { year: string; files: QuestionLibraryFile[] }[];
  files: QuestionLibraryFile[];
};

export type RecordedLibraryFile = QuestionLibraryFile & {
  day_number: number;
  display_name: string;
  meeting_name?: string | null;
  session_label: string;
  recorded_at?: string | null;
  play_url: string;
  download_url: string;
};

export type RecordedLibrary = {
  premium_required: boolean;
  library_access: boolean;
  premium_access: boolean;
  folder_id: string;
  folder_url?: string;
  items: RecordedLibraryFile[];
};

export type Resource = {
  id: number;
  title: string;
  original_filename: string;
  resource_type: string;
  public_url?: string | null;
  storage_provider: string;
  file_size?: number | null;
  duration_sec?: number | null;
  updated_at?: string | null;
};

export type ResourceRevision = {
  id: number;
  version: number;
  title: string;
  original_filename: string;
  file_size?: number | null;
  created_at: string;
};

export type Topic = {
  id: number;
  title: string;
  slug: string;
  summary: string;
  sort_order: number;
  resources: Resource[];
};

export type Module = {
  id: number;
  title: string;
  sort_order: number;
  topics: Topic[];
};

export type BatchType = "batch" | "course" | "test_series";
export type AccessPeriod = "week" | "month" | "quarter" | "year" | "lifetime" | "custom";
export type AvailabilityStatus = "available" | "scheduled" | "closed" | "full" | "enrolled";
export type LearningStatus = "available" | "upcoming" | "in_progress" | "completed" | "expired";

export type Course = {
  id: number;
  slug: string;
  title: string;
  subject: string;
  description: string;
  batch_type?: BatchType;
  access_period?: AccessPeriod;
  cover_image_url?: string | null;
  is_published: boolean;
  is_featured?: boolean;
  is_pinned?: boolean;
  display_order?: number;
  price_paise: number;
  offer_enabled?: boolean | null;
  offer_label?: string | null;
  offer_price_paise?: number | null;
  access_duration_days: number;
  launch_at?: string | null;
  enrollment_deadline?: string | null;
  max_students?: number | null;
  is_enrolled?: boolean;
  access_start?: string | null;
  access_expires_at?: string | null;
  progress?: number;
  learning_status?: LearningStatus;
  next_topic_id?: number | null;
  next_topic_title?: string | null;
  next_module_title?: string | null;
  completed_topic_ids?: number[];
  last_activity_at?: string | null;
  upcoming_live_class?: {
    id: number;
    title: string;
    scheduled_at: string;
    status: string;
  } | null;
  enrollment_source?: "payment" | "premium_access" | "free_course" | "admin" | "manual" | null;
  live_access_enabled?: boolean;
  granted_by_name?: string | null;
  seats_remaining?: number | null;
  availability_status?: AvailabilityStatus;
  module_count?: number;
  topic_count?: number;
  resource_count?: number;
  modules: Module[];
};

export type PaginatedCourseListResponse = {
  items: Course[];
  page: number;
  limit: number;
  total: number;
  total_pages: number;
  subjects: string[];
};

export type CourseDashboardItem = Course;

export type QuizQuestion = {
  id: number;
  question: string;
  options: string[];
  answer_index: number;
  explanation: string;
  year?: number | null;
  topic: string;
  question_type: string;
  source_url?: string | null;
  source_name?: string | null;
  source_type: string;
  verified: boolean;
  session: string;
  exam_date: string;
  shift: string;
  subject_code: string;
  paper: string;
  subtopics: string[];
  graph_data?: Record<string, unknown> | null;
  table_data?: Record<string, unknown> | null;
  diagram_data?: Record<string, unknown> | null;
};

export type Quiz = {
  id: number;
  topic_id: number;
  title: string;
  generated_by: string;
  subject: string;
  topic_ids: number[];
  years: number[];
  question_count: number;
  time_limit_minutes: number;
  source_folder_id?: string | null;
  available_question_count?: number;
  missing_topics?: string[];
  availability_notice?: string;
  questions: QuizQuestion[];
};

export type QuizResult = {
  score: number;
  correct: number;
  total: number;
  topic_scores: Record<string, { correct: number; total: number; percentage: number }>;
  report: string;
  strong_topics: string[];
  report_available: boolean;
  report_expires_at?: string | null;
  attempt_id: number;
  solutions: { question_id: number; correct_answer_index: number; explanation: string }[];
};

export type QuizAttempt = {
  id: number;
  quiz_id: number;
  quiz_title: string;
  status: "in_progress" | "completed" | "abandoned" | string;
  score: number;
  correct: number;
  total: number;
  answers: Record<string, number>;
  current_index: number;
  started_at?: string | null;
  expires_at?: string | null;
  topic_scores: Record<string, { correct: number; total: number; percentage: number }>;
  report: string;
  strong_topics: string[];
  report_available: boolean;
  report_expires_at?: string | null;
  time_spent_seconds: number;
  created_at: string;
  completed_at?: string | null;
};

export type StudyPlanItem = {
  id: number;
  study_date: string;
  title: string;
  topic_id?: number | null;
  duration_minutes: number;
  start_minute: number;
  end_minute: number;
  completed: boolean;
  notes: string;
  sort_order: number;
};

export type StudyPlan = {
  id: number;
  title: string;
  focus_topic: string;
  month: string;
  daily_minutes: number;
  items: StudyPlanItem[];
};

export type Notification = {
  id: number;
  user_id?: number | null;
  title: string;
  message: string;
  category: string;
  audience: string;
  link_url?: string | null;
  is_global: boolean;
  read_at?: string | null;
  created_at: string;
};

export type NotificationSettings = {
  all_notifications: boolean;
  live_class_reminders: boolean;
  new_recorded_videos: boolean;
  course_updates: boolean;
  study_reminders: boolean;
  mock_tests_results: boolean;
  progress_completion: boolean;
  payment_account_updates: boolean;
  email_notifications: boolean;
  quiet_hours: boolean;
};

export type JRFStrategyDay = {
  date: string;
  day_number: number;
  phase: string;
  paper_1_focus: string;
  paper_2_focus: string;
  sessions: { start: string; end: string; task: string; minutes: number }[];
  mcq_target: number;
  deliverable: string;
};

export type JRFStrategyPlan = {
  id: number;
  days_left: number;
  daily_study_hours: number;
  paper_2_subject: string;
  start_date: string;
  last_date: string;
  expires_at: string;
  generated_by: string;
  plan_data: { overview?: string; weekly_strategy?: string[]; days?: JRFStrategyDay[] };
  expiry_warning?: string | null;
  created_at?: string | null;
};

export type LiveClassStatus = "SCHEDULED" | "STARTING" | "LIVE" | "ENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "START_FAILED";

export type LiveClass = {
  id: number;
  course_id: number;
  course_title?: string | null;
  teacher_id: number;
  title: string;
  description?: string | null;
  provider: "meet" | "youtube" | string;
  status: LiveClassStatus;
  scheduled_at: string;
  started_at?: string | null;
  ended_at?: string | null;
  recording_status?: string | null;
  meet_uri?: string | null;
  meet_space_name?: string | null;
  google_calendar_event_id?: string | null;
  youtube_video_id?: string | null;
};

export type StudentLiveClass = {
  id: number;
  course_id: number;
  title: string;
  teacher_name: string;
  provider: "meet" | "youtube" | string;
  status: LiveClassStatus;
  can_join: boolean;
  meet_link?: string | null;
  youtube_video_id?: string | null;
  scheduled_at: string;
  started_at?: string | null;
  ended_at?: string | null;
  recording_status?: string | null;
};

export type StudentJoinResponse = {
  live_class_id: number;
  title: string;
  teacher_name: string;
  provider: string;
  status: string;
  youtube_video_id?: string | null;
  meet_link?: string | null;
  launch_token?: string | null;
};

export type LiveClassParticipant = {
  user_id: number;
  full_name: string;
  email: string;
  is_muted: boolean;
  force_muted: boolean;
  can_talk: boolean;
  can_chat: boolean;
};

export type LiveChatMessage = {
  id: number;
  user_id: number;
  user_name: string;
  message: string;
  created_at: string;
};

export type LiveClassRoom = {
  live_class_id: number;
  is_admin: boolean;
  is_muted: boolean;
  force_muted: boolean;
  can_talk: boolean;
  can_chat: boolean;
  participants: LiveClassParticipant[];
  messages: LiveChatMessage[];
};

export type PaymentReceipt = {
  receipt_id: string;
  order_id: string;
  payment_id: string;
  product: string;
  course_id?: number | null;
  amount: number;
  currency: string;
  status: string;
  paid_at?: string | null;
  access_expires_at?: string | null;
};

export type RazorpayOrder = {
  already_paid: boolean;
  already_enrolled?: boolean;
  course_id?: number;
  mock_mode?: boolean;
  key_id?: string;
  order_id?: string;
  amount?: number;
  currency?: string;
  name?: string;
  description?: string;
  prefill?: { name?: string; email?: string };
};

export type PremiumAccess = {
  premium_access: boolean;
  mock_test_access: boolean;
  premium_expires_at?: string | null;
  free_live_available: boolean;
  free_mock_available: boolean;
  free_mock_attempts_used: number;
  free_mock_attempts_remaining: number;
  free_mock_attempt_limit: number;
  razorpay_configured: boolean;
  razorpay_mode?: "live" | "test" | "unknown";
  mock_mode: boolean;
  premium_price_paise: number;
  mock_test_price_paise: number;
  currency: string;
};
