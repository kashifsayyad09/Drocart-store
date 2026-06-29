bind = "0.0.0.0:5000"
worker_class = "eventlet"
workers = 1
timeout = 120
accesslog = "-"
errorlog = "-"
forwarded_allow_ips = "*"
secure_scheme_headers = {"X-FORWARDED-PROTO": "https"}
def worker_init(worker):
    import eventlet; eventlet.monkey_patch()
