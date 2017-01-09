var cookie = require('js-cookie');
var isLoggedIn = cookie.get("zenlocker");
if (isLoggedIn) {
    location.href = "/dashboard.html";
    return;
}



var Tx = require('ethereumjs-tx');

var moment = require('moment');
var bs58 = require('bs58');
var lightwallet = require('eth-lightwallet');
var utils = require('ethereumjs-util');
var Web3 = require('web3');
var web3 = new Web3();
var EthQuery = require('eth-query');
var accounts = require('./Accounts');
var async = require('async');
var mustache = require('mustache');
var _ = require('underscore');
var HookedWeb3Provider = require("hooked-web3-provider");
var uport = require('uport-persona');

var rpcURL = '127.0.0.1';
var keyStore = lightwallet.keystore;
var registryAddress = require('./../build/contracts/UportRegistry.sol').deployed().address;
var EmailRegistry = require('./../build/contracts/EmailRegistry.sol.js');
var emailRegistry = EmailRegistry.deployed();
var Promise = require('bluebird');
var encryptionHDPath = "m/0'/0'/2'";
var test_accounts = require('./test_accounts');
var user_account = test_accounts.admin;
var password = user_account.password;
var salt = user_account.salt;
var seed = user_account.seed
var encryptionKey;


function createWeb3Provider(rpcURL, keyStoreInstance) {
    var query;
    var provider = new HookedWeb3Provider({
        host: undefined,
        transaction_signer: {
            hasAddress: function(address, callback) {
                callback(null, true);
            },
            signTransaction: function(txParams, callback) {
                async.parallel({
                    gas: function(callback) {
                        query.estimateGas(txParams, callback);
                    },
                    gasPrice: function(callback) {
                        query.gasPrice(callback);
                    }
                }, function(err, result) {
                    txParams.gas = result.gas;
                    txParams.gasPrice = result.gasPrice;
                    keyStoreInstance.signTransaction(txParams, callback);
                });
            }
        }
    });
    query = new EthQuery(provider);
    return provider;
}

function appInit(args, onSuccess, onError) {
    accounts.createNewAccount(args, function(err) {
        if (err) {
            return onError(err);
        }
        var args = _.toArray(arguments);
        args = args.slice(1);
        args.push(user_account.email);
        onSuccess.apply(this, args);
    });
}

function errorlog(e) {
    console.log('error', e);
}




var userDetails = {};

function onReady(address, encryption_key, pwDerivedKey, keyStoreInstance, email) {
    userDetails = {
        address: address,
        encryption_key: encryption_key,
        pwDerivedKey: pwDerivedKey,
        keyStoreInstance: keyStoreInstance,
        email : email
    };
    var provider = createWeb3Provider(rpcURL, keyStoreInstance);
    web3.setProvider(provider);
    EmailRegistry.setProvider(provider);
    console.log('App ready');
    console.log(address);
    document.getElementById("login").addEventListener("submit", login)
    document.getElementById("signup").addEventListener("submit", login)
}

function login(e) {
    e.preventDefault();
    var email = document.getElementById("email").value;
    var seed = document.getElementById("seed").value;
    var password = document.getElementById("password").value;
    accounts.createNewAccount({password : password, seed : seed, salt : salt}, function(err) {
        if (err) {
            $("#error").html("Invalid Login Credentials")
            return;
        }
        var args = _.toArray(arguments);
        args = args.slice(1);
        var address = args[0];
        var emailHex = utils.bufferToHex(utils.sha3(email));
        emailRegistry.getAddress(emailHex, {from : userDetails.address}).then(function (regA) {
            if (address != regA) {
                $("#error").html("Invalid Login Credentials");
                return;
            }
            var k = args[3];
            var kJSON = k.serialize();
            cookie.set("zenlocker", kJSON);
            cookie.set("emailHash", emailHex);
            location.href = "/dashboard.html"
        });
    });
}


document.addEventListener("DOMContentLoaded", function() {
    $("body").show();
    appInit({
        password: password,
        seed: seed,
        salt: 'swag'
    }, onReady, errorlog);
});
