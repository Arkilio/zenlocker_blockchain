var cookie = require('js-cookie');
var isLoggedIn = cookie.get("zenlocker");
if (isLoggedIn) {
    location.href = "/dashboard.html";
    return;
}


var NULL_ADDRESS = '0x0000000000000000000000000000000000000000';
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
var ipfs = window.IpfsApi('localhost', '5001');

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
    document.getElementById("signup").addEventListener("submit", signup)
    $("body").removeClass("hide");

}

function signup(e) {
    e.preventDefault();
    var password = document.getElementById("password").value;
    var display_name = document.getElementById("display_name").value;
    var email = document.getElementById("email").value;
    var emailHex = utils.bufferToHex(utils.sha3(email));
    emailRegistry.getAddress(emailHex, {from : userDetails.address}).then(function(address) {
        if (address != NULL_ADDRESS) {
            $("#error").html("The Email Address already exists");
            return;
        }

        var seed = keyStore.generateRandomSeed();
        var salt = user_account.salt;
        appInit({
            password : password,
            seed : seed,
            salt : salt
        }, function(address, encryption_key, pwDerivedKey, keyStoreInstance) {
            var persona = new uport.MutablePersona(address, ipfs, web3.currentProvider, registryAddress);
    		var privateKey = keyStoreInstance.exportPrivateKey(address, pwDerivedKey);
    		persona.setPublicSigningKey(privateKey);
    		persona.addAttribute({
    			encryption_key : encryption_key
    		}, privateKey);
            persona.addAttribute({display_name : display_name}, privateKey);
    		persona.writeToRegistry(address, userDetails.address).then(function(tx) {
    			return emailRegistry.registerEmailAddress(emailHex, address, {
    				from: userDetails.address
    			});
    		}).then(function(tx) {
                $("#workflow_container").remove();
                $("#postSignup").removeClass("hide");
                var loginDetails = '<p><b>Email Address</b> {{email}} <br/><b>Display Name</b><i> {{display_name}}</i><br/><b>Seed</b> {{seed}}<br/></p>'
                loginDetails = mustache.render(loginDetails, {email : email, display_name : display_name, seed : seed});
                $("#loginDetails").html(loginDetails);

    		});
        }, errorlog);


    });

}

window.signup = signup;

document.addEventListener("DOMContentLoaded", function() {

    appInit({
        password: password,
        seed: seed,
        salt: 'swag'
    }, onReady, errorlog);
});
