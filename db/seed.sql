PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO posts (
  slug,
  title,
  excerpt,
  content_md,
  status,
  published_at,
  lang,
  section
)
VALUES
  (
    'about',
    'About',
    'About Utility Box.',
    '# About\n\nUtility Box provides practical tools and guides.',
    'published',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    'en',
    'pages'
  ),
  (
    'contact',
    'Contact',
    'Contact Utility Box.',
    '# Contact\n\nFor inquiries, use the official contact channel.',
    'published',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    'en',
    'pages'
  ),
  (
    'privacy-policy',
    'Privacy Policy',
    'Privacy policy details.',
    '# Privacy Policy\n\nWe only store data required for operating the service.',
    'published',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    'en',
    'pages'
  ),
  (
    'about',
    '소개',
    'Utility Box 소개',
    '# 소개\n\nUtility Box는 실용적인 도구와 가이드를 제공합니다.',
    'published',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    'ko',
    'pages'
  ),
  (
    'contact',
    '문의하기',
    '문의 안내',
    '# 문의하기\n\n문의는 공식 채널로 보내주세요.',
    'published',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    'ko',
    'pages'
  ),
  (
    'privacy-policy',
    '개인정보 처리방침',
    '개인정보 처리방침 안내',
    '# 개인정보 처리방침\n\n서비스 운영에 필요한 최소한의 정보만 처리합니다.',
    'published',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    'ko',
    'pages'
  );
