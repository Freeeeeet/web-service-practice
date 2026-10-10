CREATE TABLE checks (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    url VARCHAR(2048) NOT NULL,
    final_url VARCHAR(2048),
    status VARCHAR(8) NOT NULL CHECK (status IN ('up', 'down')),
    http_status SMALLINT CHECK (http_status BETWEEN 100 AND 599),
    response_time_ms INTEGER NOT NULL CHECK (response_time_ms >= 0),
    error VARCHAR(300),
    is_demo BOOLEAN NOT NULL DEFAULT FALSE,
    checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX checks_checked_at_idx ON checks (checked_at DESC, id DESC);

-- Initial examples are explicitly marked as demo data, not real measurements.
INSERT INTO checks (url, final_url, status, http_status, response_time_ms, error, is_demo, checked_at) VALUES
    ('http://web-service:4000/demo/ok', 'http://web-service:4000/demo/ok', 'up', 200, 12, NULL, TRUE, NOW() - INTERVAL '6 minutes'),
    ('http://web-service:4000/demo/error', 'http://web-service:4000/demo/error', 'down', 503, 8, 'HTTP 503', TRUE, NOW() - INTERVAL '4 minutes'),
    ('http://web-service:4000/demo/ok', 'http://web-service:4000/demo/ok', 'up', 200, 10, NULL, TRUE, NOW() - INTERVAL '2 minutes');
