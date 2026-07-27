package email

import (
	"context"
	"fmt"
	"html"

	"github.com/resend/resend-go/v3"
)

type ResendSender struct {
	client *resend.Client
	from   string
}

func NewResendSender(apiKey, from string) *ResendSender {
	return &ResendSender{
		client: resend.NewClient(apiKey),
		from:   from,
	}
}

func (s *ResendSender) SendVerification(
	ctx context.Context,
	to string,
	name string,
	verificationURL string,
) error {
	request := &resend.SendEmailRequest{
		From:    s.from,
		To:      []string{to},
		Subject: "Verify your GC Go email",
		Text: fmt.Sprintf(
			"Hi %s,\n\nVerify your email address by opening this link:\n%s\n\nThis link expires in 30 minutes. If you did not create this account, you can ignore this email.",
			name,
			verificationURL,
		),
		Html: fmt.Sprintf(
			`<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#18181b">
				<h1 style="font-size:22px">Verify your email</h1>
				<p>Hi %s,</p>
				<p>Confirm that this email belongs to you. This link expires in 30 minutes.</p>
				<p style="margin:28px 0"><a href="%s" style="background:#18181b;color:#fff;padding:12px 18px;text-decoration:none">Verify email</a></p>
				<p style="font-size:13px;color:#71717a">If you did not create this account, you can ignore this email.</p>
			</div>`,
			html.EscapeString(name),
			html.EscapeString(verificationURL),
		),
	}

	_, err := s.client.Emails.SendWithContext(ctx, request)
	return err
}

func (s *ResendSender) SendPasswordReset(
	ctx context.Context,
	to string,
	name string,
	resetURL string,
) error {
	request := &resend.SendEmailRequest{
		From:    s.from,
		To:      []string{to},
		Subject: "Reset your GC Go password",
		Text: fmt.Sprintf(
			"Hi %s,\n\nReset your password by opening this link:\n%s\n\nThis link expires in 30 minutes. If you did not request a password reset, you can ignore this email.",
			name,
			resetURL,
		),
		Html: fmt.Sprintf(
			`<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#18181b">
				<h1 style="font-size:22px">Reset your password</h1>
				<p>Hi %s,</p>
				<p>Use the button below to choose a new password. This link expires in 30 minutes.</p>
				<p style="margin:28px 0"><a href="%s" style="background:#18181b;color:#fff;padding:12px 18px;text-decoration:none">Reset password</a></p>
				<p style="font-size:13px;color:#71717a">If you did not request this reset, you can safely ignore this email.</p>
			</div>`,
			html.EscapeString(name),
			html.EscapeString(resetURL),
		),
	}

	_, err := s.client.Emails.SendWithContext(ctx, request)
	return err
}

func (s *ResendSender) SendOrganizationInvitation(
	ctx context.Context,
	to string,
	organizationName string,
	invitationURL string,
) error {
	request := &resend.SendEmailRequest{
		From:    s.from,
		To:      []string{to},
		Subject: fmt.Sprintf("Join %s on GC Go", organizationName),
		Text: fmt.Sprintf(
			"You have been invited to join %s.\n\nAccept the invitation:\n%s\n\nThis link expires in 7 days.",
			organizationName,
			invitationURL,
		),
		Html: fmt.Sprintf(
			`<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#18181b">
				<h1 style="font-size:22px">Organization invitation</h1>
				<p>You have been invited to join <strong>%s</strong>.</p>
				<p style="margin:28px 0"><a href="%s" style="background:#18181b;color:#fff;padding:12px 18px;text-decoration:none">Accept invitation</a></p>
				<p style="font-size:13px;color:#71717a">This link expires in 7 days.</p>
			</div>`,
			html.EscapeString(organizationName),
			html.EscapeString(invitationURL),
		),
	}
	_, err := s.client.Emails.SendWithContext(ctx, request)
	return err
}
