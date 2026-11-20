export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <style>{`
        :root,
        body,
        body:has([data-admin-auth-shell]) {
          background: #090f16;
        }
      `}</style>
      <div data-admin-auth-shell>{children}</div>
    </>
  );
}
