#!/usr/bin/env python3
import ipaddress
import socket
import ssl
import subprocess

HOSTS = ('kinavapro.ru', 'www.kinavapro.ru')
ADDRESS = '80.93.62.58'


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=60).stdout


def addresses(resolver, host):
    result = set()
    for line in run('dig', '+time=3', '+tries=1', '+short', '@' + resolver, host, 'A').splitlines():
        try:
            result.add(str(ipaddress.IPv4Address(line.strip())))
        except ipaddress.AddressValueError:
            pass
    return result


def main():
    for resolver in ('ns1.reg.ru', '1.1.1.1', '8.8.8.8'):
        for host in HOSTS:
            if addresses(resolver, host) != {ADDRESS}:
                print('Waiting for DNS publication:', resolver, host, flush=True)
                return
    if run('docker', 'ps', '-a', '--filter', 'name=^/kinavapro-preview$', '--format', '{{.Names}}').strip():
        run('docker', 'stop', 'kinavapro-preview')
        run('docker', 'rm', 'kinavapro-preview')
    run('docker', 'compose', 'up', '-d', 'web')
    context = ssl.create_default_context()
    for host in HOSTS:
        try:
            with socket.create_connection((ADDRESS, 443), timeout=5) as connection:
                with context.wrap_socket(connection, server_hostname=host):
                    pass
        except (OSError, ssl.SSLError):
            print('Waiting for trusted HTTPS certificate:', host, flush=True)
            return
    print('DNS and trusted HTTPS are ready for both hostnames', flush=True)
    run('systemctl', 'disable', '--now', 'kinavapro-tls.timer')


if __name__ == '__main__':
    main()
