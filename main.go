package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type Task struct {
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Priority    string   `json:"priority"`
	DueDate     string   `json:"dueDate"`
	Tags        []string `json:"tags"`
}

type Board struct {
	Todo  []Task `json:"todo"`
	Doing []Task `json:"doing"`
	Done  []Task `json:"done"`
}

type Session struct {
	Username string
	Expires  time.Time
}

type Server struct {
	mux          *http.ServeMux
	storagePath  string
	board        Board
	boardMu      sync.RWMutex
	users        map[string]string
	sessions     map[string]Session
	sessionsMu   sync.RWMutex
	staticFolder string
}

func main() {
	server := NewServer("data/board.json", "web")
	server.routes()

	addr := ":8080"
	log.Printf("kanban server listening on %s", addr)
	if err := http.ListenAndServe(addr, server.mux); err != nil {
		log.Fatal(err)
	}
}

func NewServer(storagePath, staticFolder string) *Server {
	server := &Server{
		mux:          http.NewServeMux(),
		storagePath:  storagePath,
		users:        defaultUsers(),
		sessions:     make(map[string]Session),
		staticFolder: staticFolder,
	}
	if err := server.loadBoard(); err != nil {
		log.Printf("failed to load board: %v", err)
	}
	return server
}

func defaultUsers() map[string]string {
	return map[string]string{
		"gustavo": "J+A/wmjlEGXHJNIpNUD9rAZaTJwtYMEMsK8m3tWU2uI=",
		"pedro":   "dWsfhynW+XnsgmsVN7ZSps0OFJSPS5LqgQ2s7nckWX0=",
		"victor":  "cCYihIX2l9WGE1gtV5go8nN2FhIDCH2MTCWPxLkv/jg=",
	}
}

func (s *Server) routes() {
	fileServer := http.FileServer(http.Dir(s.staticFolder))
	s.mux.Handle("/", fileServer)

	s.mux.HandleFunc("/api/login", s.handleLogin)
	s.mux.HandleFunc("/api/logout", s.handleLogout)
	s.mux.HandleFunc("/api/board", s.authenticated(s.handleBoard))
}

func (s *Server) loadBoard() error {
	if err := os.MkdirAll(filepath.Dir(s.storagePath), 0o755); err != nil {
		return err
	}

	file, err := os.Open(s.storagePath)
	if errors.Is(err, os.ErrNotExist) {
		s.board = Board{}
		return s.saveBoard()
	}
	if err != nil {
		return err
	}
	defer file.Close()

	content, err := io.ReadAll(file)
	if err != nil {
		return err
	}
	if len(content) == 0 {
		s.board = Board{}
		return nil
	}

	return json.Unmarshal(content, &s.board)
}

func (s *Server) saveBoard() error {
	data, err := json.MarshalIndent(s.board, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.storagePath, data, 0o644)
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}

	var payload struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}

	hash, ok := s.users[payload.Username]
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid credentials"})
		return
	}
	if hashPassword(payload.Password) != hash {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid credentials"})
		return
	}

	token, err := generateToken()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to generate token"})
		return
	}

	s.sessionsMu.Lock()
	s.sessions[token] = Session{Username: payload.Username, Expires: time.Now().Add(12 * time.Hour)}
	s.sessionsMu.Unlock()

	writeJSON(w, http.StatusOK, map[string]string{"token": token, "user": payload.Username})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	_, token, ok := s.authorize(r)
	if ok {
		s.sessionsMu.Lock()
		delete(s.sessions, token)
		s.sessionsMu.Unlock()
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleBoard(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.boardMu.RLock()
		board := s.board
		s.boardMu.RUnlock()
		writeJSON(w, http.StatusOK, board)
	case http.MethodPut:
		var board Board
		if err := json.NewDecoder(r.Body).Decode(&board); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
			return
		}
		s.boardMu.Lock()
		s.board = board
		err := s.saveBoard()
		s.boardMu.Unlock()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save"})
			return
		}
		writeJSON(w, http.StatusOK, board)
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
}

func (s *Server) authenticated(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_, _, ok := s.authorize(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		next(w, r)
	}
}

func (s *Server) authorize(r *http.Request) (Session, string, bool) {
	parts := strings.SplitN(r.Header.Get("Authorization"), " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return Session{}, "", false
	}
	return s.lookupSession(parts[1])
}

func (s *Server) lookupSession(token string) (Session, string, bool) {
	s.sessionsMu.RLock()
	session, ok := s.sessions[token]
	s.sessionsMu.RUnlock()
	if !ok {
		return Session{}, "", false
	}
	if time.Now().After(session.Expires) {
		s.sessionsMu.Lock()
		delete(s.sessions, token)
		s.sessionsMu.Unlock()
		return Session{}, "", false
	}
	return session, token, true
}

func generateToken() (string, error) {
	buffer := make([]byte, 32)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buffer), nil
}

func hashPassword(password string) string {
	sum := sha256.Sum256([]byte(password))
	return base64.RawStdEncoding.EncodeToString(sum[:])
}

func writeJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("failed to write response: %v", err)
	}
}
